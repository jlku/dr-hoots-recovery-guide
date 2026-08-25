import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { activateServedPacket, applyRunEvent, getArtifactState, persistRunRevision, recordArtifactReview, validateRunState } from "./lib/production-run.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function parseArguments(argv) {
  const options = { runId: null, packetId: null, designerReceipt: null, userReceipt: null, stateRoot: resolve(repositoryRoot, ".production/activation"), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index], value = argv[index + 1];
    if (argument === "--run-id") options.runId = value;
    else if (argument === "--packet-id") options.packetId = value;
    else if (argument === "--designer-receipt") options.designerReceipt = resolve(value);
    else if (argument === "--user-receipt") options.userReceipt = resolve(value);
    else if (argument === "--state-root") options.stateRoot = resolve(value);
    else if (argument === "--json") { options.json = true; continue; }
    else throw new Error("unknown argument: " + argument);
    index += 1;
  }
  if (!RUN_ID_PATTERN.test(options.runId ?? "")) throw new Error("--run-id is required");
  if (!/^packet:[a-f0-9]{64}$/.test(options.packetId ?? "")) throw new Error("--packet-id is required");
  if (!options.designerReceipt || !options.userReceipt) throw new Error("both fresh review receipts are required");
  return options;
}
function validateReceipt(receipt, { role, packetId }) {
  if (receipt?.schema_version !== "activation-finished-review/v1" || receipt.role !== role || receipt.packet_id !== packetId) throw new Error("finished review receipt identity is invalid for " + role);
  if (receipt.disposition !== "pass" || !Array.isArray(receipt.critical_failures) || receipt.critical_failures.length !== 0) throw new Error("finished review did not pass for " + role);
  if (receipt.patient_ready !== false || receipt.clinical_approval !== false) throw new Error("finished review receipt overclaims its scope");
  if (!/^[a-f0-9]{64}$/.test(receipt.master_sha256 ?? "")) throw new Error("finished review master hash is invalid");
}
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runRoot = join(options.stateRoot, "runs", options.runId);
  const pointer = JSON.parse(await readFile(join(runRoot, "current.json"), "utf8"));
  let run = JSON.parse(await readFile(join(runRoot, "revisions", pointer.revision_id.slice(9) + ".json"), "utf8"));
  validateRunState(run);
  if (run.stage !== "finished_review" || run.reason_code !== "finished_review_required") throw new Error("run is not awaiting finished review");
  const [designerBytes, userBytes] = await Promise.all([readFile(options.designerReceipt), readFile(options.userReceipt)]);
  const designer = JSON.parse(designerBytes), user = JSON.parse(userBytes);
  validateReceipt(designer, { role: "independent_designer", packetId: options.packetId });
  validateReceipt(user, { role: "simulated_user", packetId: options.packetId });
  if (designer.master_sha256 !== user.master_sha256) throw new Error("fresh reviewers did not bind the same master");
  const packet = run.packets.find((candidate) => candidate.packet_id === options.packetId);
  if (!packet || packet.packet_type !== "activation_finished_private") throw new Error("finished packet is unknown");
  const master = run.artifacts.find((artifact) => packet.artifact_ids.includes(artifact.candidate_asset_id) && artifact.kind === "activation_finished_master_video");
  if (!master || master.output_hash !== designer.master_sha256) throw new Error("reviewed master hash does not match the packet");
  const gateMaterial = { packet_id: packet.packet_id, designer_receipt_sha256: sha256(designerBytes), user_receipt_sha256: sha256(userBytes), roles: ["independent_designer", "simulated_user"], disposition: "pass", critical_failures: [] };
  const gateId = "finished-review:" + sha256(JSON.stringify(gateMaterial));
  for (const artifactId of packet.artifact_ids) {
    if (getArtifactState(run, artifactId) !== "unreviewed_nonrenderable") throw new Error("finished packet artifact is not awaiting review: " + artifactId);
    run = recordArtifactReview(run, { candidateAssetId: artifactId, decision: "approved", reviewerRole: "fresh_finished_review_pair", receiptId: gateId });
  }
  run = applyRunEvent(run, "finished_reviews_passed");
  run = activateServedPacket(run, packet.packet_id);
  const gateReceipt = { schema_version: "activation-finished-review-gate/v1", gate_id: gateId, ...gateMaterial, patient_ready: false, clinical_approval: false };
  const gatePath = join(runRoot, "reviews", "finished", gateId.slice("finished-review:".length) + ".json");
  await mkdir(dirname(gatePath), { recursive: true });
  await writeFile(gatePath, JSON.stringify(gateReceipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const persistence = await persistRunRevision(options.stateRoot, run);
  const output = { gate_id: gateId, packet_id: packet.packet_id, active_packet_id: run.served_packet_pointer.active_packet_id, activation_permitted: run.served_packet_pointer.activation_permitted, revision_id: persistence.revision_id, stage: run.stage, status: run.status, patient_ready: false, clinical_approval: false };
  process.stdout.write((options.json ? JSON.stringify(output, null, 2) : JSON.stringify(output)) + "\n");
}
main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
