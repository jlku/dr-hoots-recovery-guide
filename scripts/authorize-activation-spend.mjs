import { mkdir, open, readFile, rename, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyRunEvent,
  persistRunRevision,
  validateRunState
} from "./lib/production-run.mjs";
import {
  PROVIDER_SPEND_CAP_USD,
  authorizeSpendLedger,
  createSpendLedger
} from "./lib/provider-boundary.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;

function parseArguments(argv) {
  const options = {
    runId: null,
    stateRoot: resolve(repositoryRoot, ".production/activation"),
    acceptedCapUsd: null,
    acceptanceEvidence: null,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--run-id") {
      options.runId = value;
      index += 1;
    } else if (argument === "--state-root") {
      options.stateRoot = resolve(value);
      index += 1;
    } else if (argument === "--accepted-cap-usd") {
      options.acceptedCapUsd = Number(value);
      index += 1;
    } else if (argument === "--acceptance-evidence") {
      options.acceptanceEvidence = value;
      index += 1;
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new Error("unknown argument: " + argument);
    }
  }
  if (!RUN_ID_PATTERN.test(options.runId ?? "")) throw new Error("--run-id is required");
  if (options.acceptedCapUsd !== PROVIDER_SPEND_CAP_USD) {
    throw new Error("--accepted-cap-usd must exactly match the approved USD 15 hard cap");
  }
  if (!/^operator-message-sha256:[a-f0-9]{64}$/.test(options.acceptanceEvidence ?? "")) {
    throw new Error("--acceptance-evidence must be an operator-message-sha256 identity");
  }
  return options;
}

async function loadCurrentRun(stateRoot, runId) {
  const runRoot = join(stateRoot, "runs", runId);
  const pointer = JSON.parse(await readFile(join(runRoot, "current.json"), "utf8"));
  const run = JSON.parse(
    await readFile(join(runRoot, "revisions", pointer.revision_id.slice(9) + ".json"), "utf8")
  );
  validateRunState(run);
  return { runRoot, run };
}

async function withLock(root, operation) {
  await mkdir(root, { recursive: true });
  const lockPath = join(root, ".writer.lock");
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await mkdir(lockPath);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
  if (!acquired) throw new Error("provider attempt writer is busy");
  try {
    return await operation();
  } finally {
    await rmdir(lockPath);
  }
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + ".tmp-" + process.pid;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { runRoot, run } = await loadCurrentRun(options.stateRoot, options.runId);
  if (
    run.stage !== "motion_generation" ||
    run.reason_code !== "provider_spend_authorization_required"
  ) {
    throw new Error(
      "spend may be authorized only from motion_generation/provider_spend_authorization_required"
    );
  }
  const attemptsRoot = join(runRoot, "attempts");
  const ledgerPath = join(attemptsRoot, "spend-ledger.json");
  const result = await withLock(attemptsRoot, async () => {
    let ledger;
    try {
      ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      ledger = createSpendLedger();
    }
    ledger = authorizeSpendLedger(ledger, {
      acceptedCapUsd: options.acceptedCapUsd,
      acceptanceEvidence: options.acceptanceEvidence
    });
    await atomicWrite(ledgerPath, ledger);
    const advanced = applyRunEvent(
      { ...structuredClone(run), held_reservations: structuredClone(ledger.held_reservations) },
      "provider_spend_authorized"
    );
    const persistence = await persistRunRevision(options.stateRoot, advanced);
    return { ledger, persistence, advanced };
  });
  const output = {
    accepted_cap_usd: result.ledger.accepted_cap_usd,
    acceptance_evidence: result.ledger.acceptance_evidence,
    revision_id: result.persistence.revision_id,
    stage: result.advanced.stage,
    status: result.advanced.status,
    resume_action: result.advanced.resume_action,
    provider_call_made: false
  };
  process.stdout.write((options.json ? JSON.stringify(output, null, 2) : JSON.stringify(output)) + "\n");
}

main().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
