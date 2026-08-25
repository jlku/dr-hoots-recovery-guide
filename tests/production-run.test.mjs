import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addArtifact,
  addPacket,
  activateServedPacket,
  applyRunEvent,
  buildContentLock,
  createArtifactRecord,
  createPacketRecord,
  createProductionRun,
  getArtifactState,
  invalidateForContentLock,
  persistContentLock,
  persistRunRevision,
  reportRunStop,
  validateRunState
} from "../scripts/lib/production-run.mjs";

const sha = (character) => character.repeat(64);

const lockInputs = ({ canonical = "canonical-v1", adaptation = "adaptation-v1" } = {}) => [
  { id: "canonical_module", sourcePath: "content/canonical.json", content: canonical },
  { id: "activation_adaptation", sourcePath: "content/adaptation.json", content: adaptation }
];

const makeLock = (overrides) =>
  buildContentLock({
    inputs: lockInputs(overrides),
    renderConfig: { viewport: [1280, 720], devicePixelRatio: 1 },
    toolVersions: { node: "22.16.0", renderer: "activation-renderer/v1" }
  });

test("identical input graphs reuse one immutable content-lock record", async () => {
  const first = makeLock();
  const second = buildContentLock({
    inputs: lockInputs().reverse(),
    toolVersions: { renderer: "activation-renderer/v1", node: "22.16.0" },
    renderConfig: { devicePixelRatio: 1, viewport: [1280, 720] }
  });

  assert.equal(second.lock_id, first.lock_id);
  assert.deepEqual(second, first);

  const root = await mkdtemp(join(tmpdir(), "activation-lock-"));
  const saved = await persistContentLock(root, first);
  const before = await stat(saved.path);
  const reused = await persistContentLock(root, second);
  const after = await stat(reused.path);

  assert.equal(saved.reused, false);
  assert.equal(reused.reused, true);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(JSON.parse(await readFile(saved.path, "utf8")), first);
});

test("concurrent writers serialize around one immutable lock identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "activation-lock-concurrent-"));
  const lock = makeLock();
  const writes = await Promise.all([
    persistContentLock(root, lock),
    persistContentLock(root, structuredClone(lock)),
    persistContentLock(root, structuredClone(lock))
  ]);

  assert.equal(writes.filter(({ reused }) => reused === false).length, 1);
  assert.equal(writes.filter(({ reused }) => reused === true).length, 2);
  assert.equal(new Set(writes.map(({ path }) => path)).size, 1);
});

test("a changed lock marks every dependent artifact stale without changing immutable records", () => {
  const firstLock = makeLock();
  const changedLock = makeLock({ canonical: "canonical-v2" });
  let run = createProductionRun({ runId: "fixture-run", contentLock: firstLock });

  const narration = createArtifactRecord({
    kind: "narration",
    outputHash: sha("a"),
    contentLockId: firstLock.lock_id,
    directInputIds: [firstLock.lock_id],
    filePath: "outputs/narration.mp3",
    reviewState: "approved",
    provenance: { source: "deterministic_builder" }
  });
  run = addArtifact(run, narration);

  const animatic = createArtifactRecord({
    kind: "animatic",
    outputHash: sha("b"),
    contentLockId: firstLock.lock_id,
    directInputIds: [narration.candidate_asset_id],
    filePath: "outputs/mixed-animatic.mp4",
    reviewState: "approved",
    provenance: { source: "deterministic_builder" }
  });
  run = addArtifact(run, animatic);

  const originalRecords = structuredClone(run.artifacts);
  const invalidated = invalidateForContentLock(run, changedLock);

  assert.deepEqual(run.artifacts, originalRecords, "the prior run value must remain unchanged");
  assert.deepEqual(invalidated.artifacts, originalRecords, "artifact records are immutable");
  assert.equal(getArtifactState(invalidated, narration.candidate_asset_id), "stale_nonrenderable");
  assert.equal(getArtifactState(invalidated, animatic.candidate_asset_id), "stale_nonrenderable");
  assert.equal(invalidated.artifacts[1].file_path, "outputs/mixed-animatic.mp4");
  assert.equal(invalidated.current_content_lock_id, changedLock.lock_id);
  assert.deepEqual(invalidated.valid_artifacts, []);
  assert.deepEqual(
    invalidated.stale_nodes,
    [animatic.candidate_asset_id, narration.candidate_asset_id].sort()
  );
});

test("packet identity binds artifact IDs and never activates the served pointer", () => {
  const lock = makeLock();
  let run = createProductionRun({ runId: "packet-run", contentLock: lock });
  const artifact = createArtifactRecord({
    kind: "animatic",
    outputHash: sha("f"),
    contentLockId: lock.lock_id,
    directInputIds: [lock.lock_id],
    filePath: "outputs/mixed.mp4",
    reviewState: "approved",
    provenance: { source: "deterministic_builder" }
  });
  run = addArtifact(run, artifact);
  const packet = createPacketRecord({
    packetType: "animatic_comparison",
    contentLockId: lock.lock_id,
    artifactIds: [artifact.candidate_asset_id],
    manifest: { private: true, patient_ready: false }
  });
  const withPacket = addPacket(run, packet);
  const reused = addPacket(withPacket, structuredClone(packet));

  assert.match(packet.packet_id, /^packet:[a-f0-9]{64}$/);
  assert.equal(reused, withPacket);
  assert.equal(withPacket.served_packet_pointer.active_packet_id, null);
  assert.equal(withPacket.served_packet_pointer.activation_permitted, false);
});

test("only a complete private run may activate a fully renderable finished packet", () => {
  const lock = makeLock();
  const artifact = createArtifactRecord({
    kind: "activation_finished_master_video",
    outputHash: sha("9"),
    contentLockId: lock.lock_id,
    directInputIds: [lock.lock_id],
    filePath: "exports/finished/master.mp4",
    reviewState: "approved",
    provenance: { source: "derived", tool: "fixture" }
  });
  let run = addArtifact(createProductionRun({ runId: "activate-finished", contentLock: lock }), artifact);
  const packet = createPacketRecord({ packetType: "activation_finished_private", contentLockId: lock.lock_id, artifactIds: [artifact.candidate_asset_id] });
  run = addPacket(run, packet);
  assert.throws(() => activateServedPacket(run, packet.packet_id), /complete private/i);
  for (const event of ["content_lock_approved", "radio_derivation_completed", "animatic_reviews_passed", "provider_spend_authorized", "motion_candidates_approved", "exports_assembled", "finished_reviews_passed"]) run = applyRunEvent(run, event);
  const active = activateServedPacket(run, packet.packet_id);
  assert.equal(active.served_packet_pointer.active_packet_id, packet.packet_id);
  assert.equal(active.served_packet_pointer.activation_permitted, true);
});

test("run events derive exact stage, status, reason, and resume action", () => {
  let run = createProductionRun({ runId: "state-walk", contentLock: makeLock() });
  const expected = [
    ["content_lock", "pending_review", "content_lock_approval_required", "record_content_lock_approval"],
    ["radio_derivation", "partial", "radio_derivation_required", "derive_radio_cut"],
    ["animatic_review", "pending_review", "animatic_review_required", "record_animatic_review_receipts"],
    ["motion_generation", "blocked", "provider_spend_authorization_required", "accept_provider_spend_cap"],
    ["motion_generation", "partial", "host_performances_required", "generate_next_host_performance"],
    ["export_assembly", "partial", "finished_exports_required", "assemble_finished_exports"],
    ["finished_review", "pending_review", "finished_review_required", "record_finished_review_receipts"],
    ["complete", "complete_private", null, null]
  ];
  const events = [
    "content_lock_approved",
    "radio_derivation_completed",
    "animatic_reviews_passed",
    "provider_spend_authorized",
    "motion_candidates_approved",
    "exports_assembled",
    "finished_reviews_passed"
  ];

  for (let index = 0; index < expected.length; index += 1) {
    const [stage, status, reasonCode, resumeAction] = expected[index];
    assert.deepEqual(
      [run.stage, run.status, run.reason_code, run.resume_action],
      [stage, status, reasonCode, resumeAction]
    );
    validateRunState(run);
    if (run.stage !== "complete") {
      assert.ok(Array.isArray(run.valid_artifacts));
      assert.ok(Array.isArray(run.held_reservations));
      assert.ok(Array.isArray(run.stale_nodes));
    }
    if (events[index]) run = applyRunEvent(run, events[index]);
  }

  const initial = createProductionRun({ runId: "invalid-walk", contentLock: makeLock() });
  assert.throws(() => applyRunEvent(initial, "exports_assembled"), /impossible transition/i);
  assert.throws(() => applyRunEvent(initial, "unknown_event"), /unknown run event/i);

  const missingResume = structuredClone(initial);
  delete missingResume.resume_action;
  assert.throws(() => validateRunState(missingResume), /resume_action/i);

  const impossiblePair = structuredClone(initial);
  impossiblePair.status = "complete_private";
  assert.throws(() => validateRunState(impossiblePair), /stage and status/i);
});

test("bounded stop reasons produce an exact blocked report and cannot cross stages", () => {
  let run = createProductionRun({ runId: "bounded-stop", contentLock: makeLock() });
  run = applyRunEvent(run, "content_lock_approved");
  run = applyRunEvent(run, "radio_derivation_completed");
  run = applyRunEvent(run, "animatic_reviews_passed");
  run = applyRunEvent(run, "provider_spend_authorized");

  const stopped = reportRunStop(run, "provider_spend_limit_reached");
  assert.deepEqual(
    [stopped.stage, stopped.status, stopped.reason_code, stopped.resume_action],
    [
      "motion_generation",
      "blocked",
      "provider_spend_limit_reached",
      "request_operator_direction"
    ]
  );
  assert.throws(
    () => reportRunStop(stopped, "finished_review_revision_limit_reached"),
    /impossible stop reason/i
  );
});

test("run revisions are immutable and current pointer updates atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "activation-run-"));
  const initial = createProductionRun({ runId: "persisted-run", contentLock: makeLock() });
  const first = await persistRunRevision(root, initial);
  const reused = await persistRunRevision(root, initial);
  const advanced = applyRunEvent(initial, "content_lock_approved");
  const second = await persistRunRevision(root, advanced);

  assert.equal(first.reused, false);
  assert.equal(reused.reused, true);
  assert.notEqual(second.revision_id, first.revision_id);
  assert.deepEqual(JSON.parse(await readFile(first.revision_path, "utf8")), initial);
  assert.equal(
    JSON.parse(await readFile(second.current_pointer_path, "utf8")).revision_id,
    second.revision_id
  );
});
