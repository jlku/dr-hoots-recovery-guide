import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createReviewChallenge,
  validateReviewReceipt
} from "./lib/activation-animatics.mjs";
import {
  applyRunEvent,
  persistRunRevision,
  reportRunStop,
  validateRunState
} from "./lib/production-run.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;
const REVISION_ID_PATTERN = /^revision:[a-f0-9]{64}$/;
const CHALLENGE_ID_PATTERN = /^challenge:[a-f0-9]{64}$/;

function parseArguments(argv) {
  const options = {
    stateRoot: resolve(repositoryRoot, ".production/activation"),
    runId: null,
    issue: false,
    role: null,
    evaluatorId: null,
    model: null,
    promptFile: null,
    inferenceConfigFile: null,
    allowedTools: [],
    receiptFile: null,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--issue") options.issue = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--run-id") { options.runId = value; index += 1; }
    else if (argument === "--state-root") { options.stateRoot = resolve(value); index += 1; }
    else if (argument === "--role") { options.role = value; index += 1; }
    else if (argument === "--evaluator-id") { options.evaluatorId = value; index += 1; }
    else if (argument === "--model") { options.model = value; index += 1; }
    else if (argument === "--prompt-file") { options.promptFile = resolve(value); index += 1; }
    else if (argument === "--inference-config-file") { options.inferenceConfigFile = resolve(value); index += 1; }
    else if (argument === "--allowed-tool") { options.allowedTools.push(value); index += 1; }
    else if (argument === "--receipt") { options.receiptFile = resolve(value); index += 1; }
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!RUN_ID_PATTERN.test(options.runId ?? "")) throw new Error("--run-id is required and must be valid");
  if (options.issue === Boolean(options.receiptFile)) {
    throw new Error("choose exactly one of --issue or --receipt");
  }
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function loadCurrentRun(stateRoot, runId) {
  const runRoot = join(stateRoot, "runs", runId);
  const pointer = await readJson(join(runRoot, "current.json"));
  if (pointer.run_id !== runId || !REVISION_ID_PATTERN.test(pointer.revision_id ?? "")) {
    throw new Error("run pointer is invalid");
  }
  const run = await readJson(join(runRoot, "revisions", `${pointer.revision_id.slice(9)}.json`));
  validateRunState(run);
  if (run.stage !== "animatic_review") {
    throw new Error(`animatic receipts require animatic_review, not ${run.stage}`);
  }
  const packets = run.packets.filter((packet) => packet.packet_type === "activation_animatic_comparison");
  if (packets.length === 0) throw new Error("animatic review packet is missing");
  return { runRoot, run, packet: packets.at(-1) };
}

function reviewRootFor(runRoot, packet) {
  return join(runRoot, "reviews", packet.packet_id.slice("packet:".length));
}

function packetArtifactHashes(run, packet) {
  const hashes = {};
  for (const artifactId of packet.artifact_ids) {
    const artifact = run.artifacts.find((candidate) => candidate.candidate_asset_id === artifactId);
    if (!artifact || artifact.kind !== "activation_animatic_candidate_video") continue;
    const label = artifact.provenance.neutral_label;
    if (label === "Candidate A") hashes.candidate_a = artifact.output_hash;
    if (label === "Candidate B") hashes.candidate_b = artifact.output_hash;
  }
  if (!hashes.candidate_a || !hashes.candidate_b) throw new Error("packet candidate video hashes are incomplete");
  return hashes;
}

async function issueChallenge(options) {
  const { runRoot, run, packet } = await loadCurrentRun(options.stateRoot, options.runId);
  if (!options.role || !options.evaluatorId || !options.model || !options.promptFile || !options.inferenceConfigFile) {
    throw new Error("challenge issue requires role, evaluator id, model, prompt file, and inference config file");
  }
  if (options.allowedTools.length === 0) throw new Error("challenge issue requires at least one --allowed-tool");
  const [prompt, inferenceConfiguration] = await Promise.all([
    readFile(options.promptFile, "utf8"),
    readJson(options.inferenceConfigFile)
  ]);
  const issued = createReviewChallenge({
    packetId: packet.packet_id,
    role: options.role,
    evaluatorId: options.evaluatorId,
    artifactHashes: packetArtifactHashes(run, packet),
    reviewerPromptHash: createHash("sha256").update(prompt).digest("hex"),
    rubricVersion: "activation-animatic-rubric/v1",
    model: options.model,
    inferenceConfiguration,
    allowedToolPolicy: options.allowedTools
  });
  const reviewRoot = reviewRootFor(runRoot, packet);
  const challengePath = join(reviewRoot, "challenges", `${issued.challenge.challenge_id.slice("challenge:".length)}.json`);
  await atomicWrite(challengePath, `${JSON.stringify(issued.challenge, null, 2)}\n`);
  return {
    challenge: issued.challenge,
    challenge_token: issued.token,
    warning: "Deliver the token only to the named evaluator; it is not persisted by the production state."
  };
}

async function recordReceipt(options) {
  const { runRoot, run, packet } = await loadCurrentRun(options.stateRoot, options.runId);
  const receipt = await readJson(options.receiptFile);
  if (!CHALLENGE_ID_PATTERN.test(receipt.challenge_id ?? "")) throw new Error("receipt challenge id is invalid");
  const reviewRoot = reviewRootFor(runRoot, packet);
  const challengePath = join(reviewRoot, "challenges", `${receipt.challenge_id.slice("challenge:".length)}.json`);
  const challenge = await readJson(challengePath);
  validateReviewReceipt({ challenge, receipt });
  const existingReceiptPaths = ["independent_designer", "simulated_user"].map(
    (role) => join(reviewRoot, "receipts", `${role}.json`)
  );
  const existingReceipts = [];
  for (const path of existingReceiptPaths) {
    try { existingReceipts.push(await readJson(path)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (existingReceipts.some((existing) => existing.role === receipt.role)) {
    throw new Error(`a receipt for ${receipt.role} is already recorded for this packet`);
  }
  if (existingReceipts.some((existing) => existing.evaluator_id === receipt.evaluator_id)) {
    throw new Error("the same evaluator may not satisfy both independent review roles");
  }
  const sanitized = structuredClone(receipt);
  delete sanitized.challenge_token;
  sanitized.challenge_token_sha256 = challenge.challenge_token_sha256;
  sanitized.recorded_against_revision = (await readJson(join(runRoot, "current.json"))).revision_id;
  await atomicWrite(join(reviewRoot, "receipts", `${receipt.role}.json`), `${JSON.stringify(sanitized, null, 2)}\n`);
  await atomicWrite(join(reviewRoot, "consumed", `${receipt.challenge_id.slice("challenge:".length)}.json`), `${JSON.stringify({
    schema_version: "activation-review-challenge-consumption/v1",
    challenge_id: receipt.challenge_id,
    packet_id: packet.packet_id,
    role: receipt.role,
    evaluator_id: receipt.evaluator_id
  }, null, 2)}\n`);

  const allReceipts = [...existingReceipts, sanitized];
  let nextRun = run;
  let gateState = "pending_review";
  if (sanitized.disposition !== "pass" || sanitized.critical_failures.length > 0) {
    nextRun = reportRunStop(run, "animatic_review_failed");
    gateState = "failed_repair_required";
  } else if (
    allReceipts.length === 2 &&
    new Set(allReceipts.map((entry) => entry.role)).size === 2 &&
    allReceipts.every((entry) => entry.disposition === "pass" && entry.critical_failures.length === 0)
  ) {
    nextRun = applyRunEvent(run, "animatic_reviews_passed");
    gateState = "passed_radio_locked";
  }
  const persistence = nextRun === run ? null : await persistRunRevision(options.stateRoot, nextRun);
  return {
    packet_id: packet.packet_id,
    recorded_role: receipt.role,
    gate_state: gateState,
    receipt_count: allReceipts.length,
    revision_id: persistence?.revision_id ?? (await readJson(join(runRoot, "current.json"))).revision_id,
    stage: nextRun.stage,
    status: nextRun.status,
    resume_action: nextRun.resume_action
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = options.issue ? await issueChallenge(options) : await recordReceipt(options);
  process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : JSON.stringify(result)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
