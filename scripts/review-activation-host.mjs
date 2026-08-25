import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyRunEvent,
  getArtifactState,
  persistRunRevision,
  recordArtifactReview,
  validateRunState
} from "./lib/production-run.mjs";
import { transitionProviderAttempt } from "./lib/provider-boundary.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;
const ASSET_PATTERN = /^asset:[a-f0-9]{64}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArguments(argv) {
  const options = { runId: null, stateRoot: resolve(repositoryRoot, ".production/activation"), candidateAssetId: null, decision: null, reviewerRole: null, reason: null, evidence: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--run-id") options.runId = value;
    else if (argument === "--state-root") options.stateRoot = resolve(value);
    else if (argument === "--candidate-asset-id") options.candidateAssetId = value;
    else if (argument === "--decision") options.decision = value;
    else if (argument === "--reviewer-role") options.reviewerRole = value;
    else if (argument === "--reason") options.reason = value;
    else if (argument === "--evidence") options.evidence = value;
    else if (argument === "--json") { options.json = true; continue; }
    else throw new Error("unknown argument: " + argument);
    index += 1;
  }
  if (!RUN_ID_PATTERN.test(options.runId ?? "")) throw new Error("--run-id is required");
  if (!ASSET_PATTERN.test(options.candidateAssetId ?? "")) throw new Error("--candidate-asset-id is required");
  if (!["approved", "rejected"].includes(options.decision)) throw new Error("--decision must be approved or rejected");
  if (!options.reviewerRole) throw new Error("--reviewer-role is required");
  if (options.decision === "rejected" && !options.reason) throw new Error("--reason is required for rejection");
  if (!/^[-a-z]+-sha256:[a-f0-9]{64}$/.test(options.evidence ?? "")) throw new Error("--evidence must be a hash-bound identity");
  return options;
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + ".tmp-" + process.pid;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
}

async function withLock(root, operation) {
  await mkdir(root, { recursive: true });
  const lockPath = join(root, ".writer.lock");
  let acquired = false;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { await mkdir(lockPath); acquired = true; break; }
    catch (error) { if (error.code !== "EEXIST") throw error; await new Promise((resolveWait) => setTimeout(resolveWait, 10)); }
  }
  if (!acquired) throw new Error("provider attempt writer is busy");
  try { return await operation(); }
  finally { await rmdir(lockPath); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runRoot = join(options.stateRoot, "runs", options.runId);
  const attemptsRoot = join(runRoot, "attempts");
  const result = await withLock(attemptsRoot, async () => {
    const pointer = JSON.parse(await readFile(join(runRoot, "current.json"), "utf8"));
    let run = JSON.parse(await readFile(join(runRoot, "revisions", pointer.revision_id.slice(9) + ".json"), "utf8"));
    validateRunState(run);
    if (run.stage !== "motion_generation" || run.reason_code !== "host_performances_required") throw new Error("host review is allowed only during motion generation");
    const artifact = run.artifacts.find((candidate) => candidate.candidate_asset_id === options.candidateAssetId);
    if (!artifact || !new Set(["activation_host_performance_candidate", "activation_host_performance_composition_candidate"]).has(artifact.kind)) throw new Error("candidate is not a host performance artifact");
    if (getArtifactState(run, artifact.candidate_asset_id) !== "unreviewed_nonrenderable") throw new Error("candidate review is already terminal");
    const ledgerPath = join(attemptsRoot, "spend-ledger.json");
    let ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const sourceArtifact = artifact.kind === "activation_host_performance_candidate"
      ? artifact
      : run.artifacts.find((candidate) => artifact.direct_input_ids.includes(candidate.candidate_asset_id) && candidate.kind === "activation_host_performance_candidate");
    if (!sourceArtifact) throw new Error("composition candidate is missing its provider source artifact");
    const attempt = ledger.attempts.find((candidate) => candidate.provider_request_id === sourceArtifact.provenance.request_id);
    if (!attempt || attempt.state !== "succeeded_unreviewed") throw new Error("candidate provider attempt is not awaiting review");
    const receipt = {
      schema_version: "activation-host-review/v1",
      run_id: options.runId,
      candidate_asset_id: artifact.candidate_asset_id,
      output_sha256: artifact.output_hash,
      performance_id: artifact.provenance.settings.performance_id,
      decision: options.decision,
      reviewer_role: options.reviewerRole,
      evidence: options.evidence,
      reason: options.reason,
      patient_ready: false
    };
    const receiptId = "host-review:" + sha256(JSON.stringify(receipt));
    receipt.receipt_id = receiptId;
    const transitioned = transitionProviderAttempt(ledger, { reservationId: attempt.reservation_id, event: options.decision === "approved" ? "review_approved" : "review_rejected" });
    ledger = transitioned.ledger;
    run = recordArtifactReview(run, { candidateAssetId: artifact.candidate_asset_id, decision: options.decision, reviewerRole: options.reviewerRole, receiptId, reason: options.reason });
    const approvedPerformances = new Set(run.artifacts.filter((candidate) => new Set(["activation_host_performance_candidate", "activation_host_performance_composition_candidate"]).has(candidate.kind) && getArtifactState(run, candidate.candidate_asset_id) === "renderable").map((candidate) => candidate.provenance.settings.performance_id));
    if (approvedPerformances.has("host/healing") && approvedPerformances.has("host/follow-up")) run = applyRunEvent(run, "motion_candidates_approved");
    await atomicWrite(join(runRoot, "reviews", "host-performances", receiptId.slice("host-review:".length) + ".json"), receipt);
    await atomicWrite(ledgerPath, ledger);
    const persistence = await persistRunRevision(options.stateRoot, { ...structuredClone(run), held_reservations: structuredClone(ledger.held_reservations) });
    return { receipt, ledger, run, persistence };
  });
  const output = { receipt_id: result.receipt.receipt_id, decision: result.receipt.decision, performance_id: result.receipt.performance_id, committed_spend_usd: result.ledger.committed_spend_usd, revision_id: result.persistence.revision_id, stage: result.run.stage, status: result.run.status, patient_ready: false };
  process.stdout.write((options.json ? JSON.stringify(output, null, 2) : JSON.stringify(output)) + "\n");
}

main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
