import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rmdir,
  stat
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const STATE_BY_REASON = Object.freeze({
  content_lock_approval_required: {
    stage: "content_lock",
    status: "pending_review",
    resume_action: "record_content_lock_approval"
  },
  content_lock_dependency_missing: {
    stage: "content_lock",
    status: "blocked",
    resume_action: "restore_content_lock_dependency"
  },
  radio_derivation_required: {
    stage: "radio_derivation",
    status: "partial",
    resume_action: "derive_radio_cut"
  },
  radio_derivation_failed: {
    stage: "radio_derivation",
    status: "blocked",
    resume_action: "repair_radio_derivation"
  },
  animatic_review_required: {
    stage: "animatic_review",
    status: "pending_review",
    resume_action: "record_animatic_review_receipts"
  },
  animatic_review_revision_limit_reached: {
    stage: "animatic_review",
    status: "blocked",
    resume_action: "request_operator_direction"
  },
  animatic_review_failed: {
    stage: "animatic_review",
    status: "partial",
    resume_action: "repair_animatic_comparison"
  },
  provider_spend_authorization_required: {
    stage: "motion_generation",
    status: "blocked",
    resume_action: "accept_provider_spend_cap"
  },
  host_performances_required: {
    stage: "motion_generation",
    status: "partial",
    resume_action: "generate_next_host_performance"
  },
  provider_outcome_unknown: {
    stage: "motion_generation",
    status: "blocked",
    resume_action: "reconcile_provider_request"
  },
  provider_attempt_limit_reached: {
    stage: "motion_generation",
    status: "blocked",
    resume_action: "request_operator_direction"
  },
  provider_spend_limit_reached: {
    stage: "motion_generation",
    status: "blocked",
    resume_action: "request_operator_direction"
  },
  finished_exports_required: {
    stage: "export_assembly",
    status: "partial",
    resume_action: "assemble_finished_exports"
  },
  export_dependency_stale: {
    stage: "export_assembly",
    status: "blocked",
    resume_action: "rebuild_stale_dependencies"
  },
  finished_review_required: {
    stage: "finished_review",
    status: "pending_review",
    resume_action: "record_finished_review_receipts"
  },
  finished_review_revision_limit_reached: {
    stage: "finished_review",
    status: "blocked",
    resume_action: "request_operator_direction"
  }
});

const EVENT_DEFINITIONS = Object.freeze({
  content_lock_approved: {
    from: ["content_lock"],
    reason_code: "radio_derivation_required"
  },
  radio_derivation_completed: {
    from: ["radio_derivation"],
    reason_code: "animatic_review_required"
  },
  animatic_reviews_passed: {
    from: ["animatic_review"],
    reason_code: "provider_spend_authorization_required"
  },
  provider_spend_authorized: {
    from: ["motion_generation"],
    required_reason: "provider_spend_authorization_required",
    reason_code: "host_performances_required"
  },
  motion_candidates_approved: {
    from: ["motion_generation"],
    required_reason: "host_performances_required",
    reason_code: "finished_exports_required"
  },
  exports_assembled: {
    from: ["export_assembly"],
    reason_code: "finished_review_required"
  },
  finished_reviews_passed: {
    from: ["finished_review"],
    complete: true
  },
  animatic_repair_required: {
    from: ["animatic_review"],
    reason_code: "radio_derivation_required"
  },
  performance_repair_required: {
    from: ["finished_review"],
    reason_code: "host_performances_required"
  },
  export_repair_required: {
    from: ["finished_review"],
    reason_code: "finished_exports_required"
  }
});

function canonicalValue(value, location = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((child, index) => canonicalValue(child, `${location}[${index}]`));
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`${location}.${key} may not be undefined`);
      result[key] = canonicalValue(value[key], `${location}.${key}`);
    }
    return result;
  }
  throw new TypeError(`${location} is not JSON-safe`);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function lockRecord(lock) {
  validateContentLock(lock);
  return {
    lock_id: lock.lock_id,
    input_graph_sha256: lock.input_graph_sha256
  };
}

function bytesForInput(input) {
  if (typeof input.content === "string") return Buffer.from(input.content);
  if (Buffer.isBuffer(input.content) || input.content instanceof Uint8Array) {
    return Buffer.from(input.content);
  }
  if (input.content && typeof input.content === "object") {
    return Buffer.from(canonicalJson(input.content));
  }
  throw new TypeError(`${input.id ?? "input"}.content must be a string, byte array, or JSON value`);
}

export function buildContentLock({ inputs, renderConfig = {}, toolVersions = {} }) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new TypeError("content lock requires at least one input");
  }

  const ids = new Set();
  const inputRecords = inputs.map((input) => {
    requireNonEmptyString(input.id, "input id");
    requireNonEmptyString(input.sourcePath, `${input.id}.sourcePath`);
    if (isAbsolute(input.sourcePath)) throw new Error(`${input.id}.sourcePath must be repository-relative`);
    if (ids.has(input.id)) throw new Error(`duplicate content-lock input id: ${input.id}`);
    ids.add(input.id);
    const bytes = bytesForInput(input);
    return {
      id: input.id,
      source_path: input.sourcePath.replaceAll("\\", "/"),
      sha256: sha256(bytes),
      byte_length: bytes.byteLength
    };
  });
  inputRecords.sort((left, right) => left.id.localeCompare(right.id));

  const graph = canonicalValue({
    inputs: inputRecords,
    render_config: renderConfig,
    tool_versions: toolVersions
  });
  const inputGraphSha256 = sha256(canonicalJson(graph));
  return deepFreeze({
    schema_version: "activation-content-lock/v1",
    lock_id: `lock:${inputGraphSha256}`,
    input_graph_sha256: inputGraphSha256,
    ...graph
  });
}

export function validateContentLock(lock) {
  if (lock?.schema_version !== "activation-content-lock/v1") {
    throw new Error("unsupported content-lock schema");
  }
  if (lock.lock_id !== `lock:${lock.input_graph_sha256}` || !SHA256_PATTERN.test(lock.input_graph_sha256)) {
    throw new Error("content-lock identity does not match its input graph hash");
  }
  const rebuilt = buildContentLock({
    inputs: lock.inputs.map((input) => ({
      id: input.id,
      sourcePath: input.source_path,
      content: { sha256: input.sha256, byte_length: input.byte_length }
    })),
    renderConfig: lock.render_config,
    toolVersions: lock.tool_versions
  });
  const graph = canonicalValue({
    inputs: lock.inputs,
    render_config: lock.render_config,
    tool_versions: lock.tool_versions
  });
  const actual = sha256(canonicalJson(graph));
  if (actual !== lock.input_graph_sha256) {
    throw new Error("content-lock graph hash is invalid");
  }
  // Referencing rebuilt ensures each stored input also passes id/path validation.
  void rebuilt;
  return true;
}

function runStateForReason(reasonCode) {
  const state = STATE_BY_REASON[reasonCode];
  if (!state) throw new Error(`unknown run-state reason_code: ${reasonCode}`);
  return { ...state, reason_code: reasonCode };
}

function completeRunState() {
  return {
    stage: "complete",
    status: "complete_private",
    reason_code: null,
    resume_action: null
  };
}

function appendState(run, event, state) {
  const stateEvent = {
    sequence: run.state_events.length + 1,
    event,
    ...state
  };
  const next = {
    ...clone(run),
    ...state,
    state_events: [...clone(run.state_events), stateEvent]
  };
  validateRunState(next);
  return deepFreeze(next);
}

export function createProductionRun({ runId, contentLock }) {
  if (!RUN_ID_PATTERN.test(runId ?? "")) throw new Error("run id is invalid");
  validateContentLock(contentLock);
  const state = runStateForReason("content_lock_approval_required");
  const run = {
    schema_version: "activation-production-run/v1",
    run_id: runId,
    content_locks: [lockRecord(contentLock)],
    current_content_lock_id: contentLock.lock_id,
    artifacts: [],
    packets: [],
    artifact_state_events: [],
    valid_artifacts: [],
    held_reservations: [],
    stale_nodes: [],
    state_events: [{ sequence: 1, event: "content_lock_created", ...state }],
    served_packet_pointer: {
      active_packet_id: null,
      activation_permitted: false,
      schema_version: "activation-served-packet-pointer/v1"
    },
    ...state
  };
  validateRunState(run);
  return deepFreeze(run);
}

export function validateRunState(run) {
  if (run?.schema_version !== "activation-production-run/v1") {
    throw new Error("unsupported production-run schema");
  }
  if (!RUN_ID_PATTERN.test(run.run_id ?? "")) throw new Error("run id is invalid");
  if (!Array.isArray(run.state_events) || run.state_events.length === 0) {
    throw new Error("run must contain an append-only state event");
  }
  for (const field of ["valid_artifacts", "held_reservations", "stale_nodes"]) {
    if (!Array.isArray(run[field])) throw new Error(`run must record ${field}`);
  }

  const expected = run.reason_code === null ? completeRunState() : runStateForReason(run.reason_code);
  if (run.stage !== expected.stage || run.status !== expected.status) {
    throw new Error(`invalid stage and status pair: ${run.stage}/${run.status}`);
  }
  if (run.resume_action !== expected.resume_action) {
    throw new Error(`resume_action must be exactly ${expected.resume_action ?? "null"}`);
  }
  if (run.stage !== "complete" && typeof run.resume_action !== "string") {
    throw new Error("every non-complete state requires a resume_action");
  }
  if (run.status === "patient_ready" || run.status === "complete") {
    throw new Error("production runs may never report patient readiness");
  }

  const latest = run.state_events.at(-1);
  for (const key of ["stage", "status", "reason_code", "resume_action"]) {
    if (latest[key] !== run[key]) throw new Error(`run ${key} must match its latest state event`);
  }
  for (let index = 0; index < run.state_events.length; index += 1) {
    if (run.state_events[index].sequence !== index + 1) {
      throw new Error("run state event sequence is not append-only");
    }
  }
  return true;
}

export function applyRunEvent(run, event) {
  validateRunState(run);
  const definition = EVENT_DEFINITIONS[event];
  if (!definition) throw new Error(`unknown run event: ${event}`);
  if (
    !definition.from.includes(run.stage) ||
    (definition.required_reason && run.reason_code !== definition.required_reason)
  ) {
    throw new Error(`impossible transition: ${event} from ${run.stage}/${run.reason_code}`);
  }
  const state = definition.complete ? completeRunState() : runStateForReason(definition.reason_code);
  return appendState(run, event, state);
}

export function reportRunStop(run, reasonCode) {
  validateRunState(run);
  const state = runStateForReason(reasonCode);
  if (state.stage !== run.stage) {
    throw new Error(`impossible stop reason ${reasonCode} while run is at ${run.stage}`);
  }
  if (state.status === "complete_private") {
    throw new Error("reportRunStop may not complete a run");
  }
  return appendState(run, "run_stopped", state);
}

export function createArtifactRecord({
  kind,
  outputHash,
  contentLockId,
  directInputIds,
  filePath,
  provenance,
  reviewState = "unreviewed",
  rejectionReason = null
}) {
  requireNonEmptyString(kind, "artifact kind");
  if (!SHA256_PATTERN.test(outputHash ?? "")) throw new Error("artifact outputHash must be a SHA-256 hex digest");
  requireNonEmptyString(contentLockId, "artifact contentLockId");
  if (!Array.isArray(directInputIds) || directInputIds.length === 0) {
    throw new Error("artifact must record at least one direct input identity");
  }
  for (const inputId of directInputIds) requireNonEmptyString(inputId, "direct input identity");
  requireNonEmptyString(filePath, "artifact filePath");
  if (isAbsolute(filePath)) throw new Error("artifact filePath must be run-relative");
  if (!provenance || typeof provenance !== "object") throw new Error("artifact provenance is required");
  requireNonEmptyString(provenance.source, "artifact provenance source");
  if (provenance.source === "generated") {
    for (const field of ["prompt", "model", "request_id"]) {
      requireNonEmptyString(provenance[field], `generated artifact provenance ${field}`);
    }
    if (!Object.hasOwn(provenance, "settings")) {
      throw new Error("generated artifact provenance settings are required");
    }
  }
  if (!new Set(["unreviewed", "approved", "rejected"]).has(reviewState)) {
    throw new Error(`unknown artifact review state: ${reviewState}`);
  }
  if (reviewState === "rejected" && !rejectionReason) {
    throw new Error("a rejected artifact requires a rejection reason");
  }
  if (reviewState !== "rejected" && rejectionReason !== null) {
    throw new Error("only rejected artifacts may record a rejection reason");
  }

  const identityMaterial = canonicalValue({
    kind,
    output_hash: outputHash,
    content_lock_id: contentLockId,
    direct_input_ids: [...new Set(directInputIds)].sort(),
    provenance
  });
  const record = {
    schema_version: "activation-artifact/v1",
    candidate_asset_id: `asset:${sha256(canonicalJson(identityMaterial))}`,
    ...identityMaterial,
    file_path: filePath.replaceAll("\\", "/"),
    review_state: reviewState,
    rejection_reason: rejectionReason
  };
  return deepFreeze(record);
}

export function createPacketRecord({ packetType, contentLockId, artifactIds, manifest = {} }) {
  requireNonEmptyString(packetType, "packet type");
  requireNonEmptyString(contentLockId, "packet contentLockId");
  if (!Array.isArray(artifactIds) || artifactIds.length === 0) {
    throw new Error("packet must bind at least one artifact identity");
  }
  for (const artifactId of artifactIds) requireNonEmptyString(artifactId, "packet artifact identity");
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new Error("packet artifact identities must be unique");
  }
  const identityMaterial = canonicalValue({
    packet_type: packetType,
    content_lock_id: contentLockId,
    artifact_ids: artifactIds,
    manifest
  });
  return deepFreeze({
    schema_version: "activation-packet/v1",
    packet_id: `packet:${sha256(canonicalJson(identityMaterial))}`,
    ...identityMaterial
  });
}

export function addPacket(run, packet) {
  validateRunState(run);
  if (packet?.schema_version !== "activation-packet/v1") {
    throw new Error("unsupported packet schema");
  }
  const existing = run.packets.find((candidate) => candidate.packet_id === packet.packet_id);
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(packet)) {
      throw new Error(`immutable packet identity collision: ${packet.packet_id}`);
    }
    return run;
  }
  if (packet.content_lock_id !== run.current_content_lock_id) {
    throw new Error("packet must bind the current content lock");
  }
  const knownArtifactIds = new Set(run.artifacts.map((artifact) => artifact.candidate_asset_id));
  const missing = packet.artifact_ids.filter((artifactId) => !knownArtifactIds.has(artifactId));
  if (missing.length) throw new Error(`packet has unknown artifact identities: ${missing.join(", ")}`);
  return deepFreeze({ ...clone(run), packets: [...clone(run.packets), clone(packet)] });
}

export function activateServedPacket(run, packetId) {
  validateRunState(run);
  requireNonEmptyString(packetId, "packetId");
  if (run.stage !== "complete" || run.status !== "complete_private") {
    throw new Error("served packet activation requires a complete private run");
  }
  const packet = run.packets.find((candidate) => candidate.packet_id === packetId);
  if (!packet || packet.packet_type !== "activation_finished_private") {
    throw new Error("served packet must be a recorded finished private packet");
  }
  if (packet.content_lock_id !== run.current_content_lock_id) {
    throw new Error("served packet content lock is stale");
  }
  const nonRenderable = packet.artifact_ids.filter(
    (artifactId) => getArtifactState(run, artifactId) !== "renderable"
  );
  if (nonRenderable.length) {
    throw new Error("served packet contains non-renderable artifacts: " + nonRenderable.join(", "));
  }
  return deepFreeze({
    ...clone(run),
    served_packet_pointer: {
      schema_version: "activation-served-packet-pointer/v1",
      active_packet_id: packetId,
      activation_permitted: true
    }
  });
}

function initialArtifactState(reviewState) {
  if (reviewState === "approved") return "renderable";
  if (reviewState === "rejected") return "rejected_nonrenderable";
  return "unreviewed_nonrenderable";
}

export function addArtifact(run, artifact) {
  validateRunState(run);
  if (artifact?.schema_version !== "activation-artifact/v1") {
    throw new Error("unsupported artifact schema");
  }
  const existing = run.artifacts.find(
    (candidate) => candidate.candidate_asset_id === artifact.candidate_asset_id
  );
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(artifact)) {
      throw new Error(`immutable artifact identity collision: ${artifact.candidate_asset_id}`);
    }
    return run;
  }
  if (!run.content_locks.some((lock) => lock.lock_id === artifact.content_lock_id)) {
    throw new Error("artifact content lock is not recorded by this run");
  }
  const knownInputs = new Set([
    ...run.content_locks.map((lock) => lock.lock_id),
    ...run.artifacts.map((candidate) => candidate.candidate_asset_id)
  ]);
  const missing = artifact.direct_input_ids.filter((inputId) => !knownInputs.has(inputId));
  if (missing.length) throw new Error(`artifact has unknown direct input identities: ${missing.join(", ")}`);

  const stateEvent = {
    sequence: run.artifact_state_events.length + 1,
    event: "artifact_recorded",
    candidate_asset_id: artifact.candidate_asset_id,
    state: initialArtifactState(artifact.review_state),
    reason_code:
      artifact.review_state === "approved"
        ? "review_approved"
        : artifact.review_state === "rejected"
          ? "review_rejected"
          : "review_required"
  };
  return deepFreeze({
    ...clone(run),
    artifacts: [...clone(run.artifacts), clone(artifact)],
    artifact_state_events: [...clone(run.artifact_state_events), stateEvent],
    valid_artifacts:
      stateEvent.state === "renderable"
        ? [...clone(run.valid_artifacts), artifact.candidate_asset_id].sort()
        : clone(run.valid_artifacts)
  });
}

export function getArtifactState(run, candidateAssetId) {
  const event = run.artifact_state_events
    .filter((entry) => entry.candidate_asset_id === candidateAssetId)
    .at(-1);
  if (!event) throw new Error(`artifact state is missing: ${candidateAssetId}`);
  return event.state;
}

export function recordArtifactReview(
  run,
  { candidateAssetId, decision, reviewerRole, receiptId, reason = null }
) {
  validateRunState(run);
  requireNonEmptyString(candidateAssetId, "candidateAssetId");
  requireNonEmptyString(reviewerRole, "reviewerRole");
  requireNonEmptyString(receiptId, "receiptId");
  if (!new Set(["approved", "rejected"]).has(decision)) {
    throw new Error("artifact review decision must be approved or rejected");
  }
  if (decision === "rejected") requireNonEmptyString(reason, "review rejection reason");
  if (decision === "approved" && reason !== null) {
    throw new Error("approved artifact reviews may not record a rejection reason");
  }
  const artifact = run.artifacts.find(
    (candidate) => candidate.candidate_asset_id === candidateAssetId
  );
  if (!artifact) throw new Error(`artifact is unknown: ${candidateAssetId}`);
  if (getArtifactState(run, candidateAssetId) !== "unreviewed_nonrenderable") {
    throw new Error(`artifact review is already terminal: ${candidateAssetId}`);
  }
  const state = decision === "approved" ? "renderable" : "rejected_nonrenderable";
  const event = {
    sequence: run.artifact_state_events.length + 1,
    event: decision === "approved" ? "artifact_review_approved" : "artifact_review_rejected",
    candidate_asset_id: candidateAssetId,
    state,
    reason_code: decision === "approved" ? "review_approved" : "review_rejected",
    reviewer_role: reviewerRole,
    receipt_id: receiptId,
    ...(reason ? { rejection_reason: reason } : {})
  };
  return deepFreeze({
    ...clone(run),
    artifact_state_events: [...clone(run.artifact_state_events), event],
    valid_artifacts:
      decision === "approved"
        ? [...new Set([...run.valid_artifacts, candidateAssetId])].sort()
        : run.valid_artifacts.filter((id) => id !== candidateAssetId)
  });
}

export function invalidateForContentLock(run, contentLock) {
  validateRunState(run);
  validateContentLock(contentLock);
  if (contentLock.lock_id === run.current_content_lock_id) return run;

  const staleIds = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const artifact of run.artifacts) {
      if (staleIds.has(artifact.candidate_asset_id)) continue;
      if (
        artifact.content_lock_id === run.current_content_lock_id ||
        artifact.direct_input_ids.includes(run.current_content_lock_id) ||
        artifact.direct_input_ids.some((inputId) => staleIds.has(inputId))
      ) {
        staleIds.add(artifact.candidate_asset_id);
        changed = true;
      }
    }
  }

  const newStateEvents = [];
  let sequence = run.artifact_state_events.length;
  for (const artifact of run.artifacts) {
    if (!staleIds.has(artifact.candidate_asset_id)) continue;
    sequence += 1;
    newStateEvents.push({
      sequence,
      event: "content_lock_invalidated",
      candidate_asset_id: artifact.candidate_asset_id,
      state: "stale_nonrenderable",
      reason_code: "content_lock_changed",
      superseded_content_lock_id: run.current_content_lock_id,
      current_content_lock_id: contentLock.lock_id
    });
  }

  const locks = run.content_locks.some((lock) => lock.lock_id === contentLock.lock_id)
    ? clone(run.content_locks)
    : [...clone(run.content_locks), lockRecord(contentLock)];
  const reset = {
    ...clone(run),
    content_locks: locks,
    current_content_lock_id: contentLock.lock_id,
    artifact_state_events: [...clone(run.artifact_state_events), ...newStateEvents],
    valid_artifacts: run.valid_artifacts.filter((artifactId) => !staleIds.has(artifactId)),
    stale_nodes: [...new Set([...run.stale_nodes, ...staleIds])].sort()
  };
  return appendState(reset, "content_lock_changed", runStateForReason("content_lock_approval_required"));
}

function assertRenderableDependencies(run, artifact, seen = new Set()) {
  if (seen.has(artifact.candidate_asset_id)) throw new Error("artifact dependency cycle detected");
  seen.add(artifact.candidate_asset_id);
  for (const inputId of artifact.direct_input_ids) {
    if (inputId.startsWith("lock:")) {
      if (inputId !== run.current_content_lock_id) {
        throw new Error(`artifact dependency is stale_nonrenderable: ${inputId}`);
      }
      continue;
    }
    const dependency = run.artifacts.find((candidate) => candidate.candidate_asset_id === inputId);
    if (!dependency) throw new Error(`artifact dependency is missing: ${inputId}`);
    const state = getArtifactState(run, inputId);
    if (state === "stale_nonrenderable") {
      throw new Error(`artifact dependency is stale_nonrenderable: ${inputId}`);
    }
    assertRenderableDependencies(run, dependency, new Set(seen));
  }
}

export function resolveCandidateAsset(run, selector) {
  validateRunState(run);
  if (
    typeof selector === "string" ||
    selector?.filename !== undefined ||
    selector?.file_path !== undefined ||
    selector?.path !== undefined
  ) {
    throw new Error("filename resolution is forbidden; use candidate_asset_id");
  }
  requireNonEmptyString(selector?.candidate_asset_id, "candidate_asset_id");
  requireNonEmptyString(selector?.content_lock_id, "content_lock_id");

  const artifact = run.artifacts.find(
    (candidate) => candidate.candidate_asset_id === selector.candidate_asset_id
  );
  if (!artifact) throw new Error(`candidate asset is not recorded: ${selector.candidate_asset_id}`);
  const state = getArtifactState(run, artifact.candidate_asset_id);
  if (state === "stale_nonrenderable") {
    throw new Error(`candidate asset is stale_nonrenderable: ${artifact.candidate_asset_id}`);
  }
  if (selector.content_lock_id !== run.current_content_lock_id) {
    throw new Error("candidate selector does not name the current content lock");
  }
  if (artifact.content_lock_id !== run.current_content_lock_id) {
    throw new Error("candidate asset does not match the current content lock");
  }
  if (state !== "renderable") {
    throw new Error(`candidate asset is not review-approved: ${artifact.candidate_asset_id}`);
  }
  assertRenderableDependencies(run, artifact);
  return artifact;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function wait(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function withWriterLock(root, operation) {
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
      await wait(10);
    }
  }
  if (!acquired) throw new Error(`production writer is busy: ${lockPath}`);
  try {
    return await operation();
  } finally {
    await rmdir(lockPath);
  }
}

async function syncDirectory(path) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  await syncDirectory(dirname(path));
}

async function writeImmutableJson(path, value) {
  if (await pathExists(path)) {
    const existing = JSON.parse(await readFile(path, "utf8"));
    if (canonicalJson(existing) !== canonicalJson(value)) {
      throw new Error(`immutable record collision at ${path}`);
    }
    return true;
  }
  await atomicWriteJson(path, value);
  return false;
}

export async function persistContentLock(root, lock) {
  validateContentLock(lock);
  return withWriterLock(root, async () => {
    const path = join(root, "locks", `${lock.input_graph_sha256}.json`);
    const reused = await writeImmutableJson(path, lock);
    return { path, lock_id: lock.lock_id, reused };
  });
}

export async function persistRunRevision(root, run) {
  validateRunState(run);
  return withWriterLock(root, async () => {
    const revisionId = `revision:${sha256(canonicalJson(run))}`;
    const runRoot = join(root, "runs", run.run_id);
    const revisionPath = join(runRoot, "revisions", `${revisionId.slice("revision:".length)}.json`);
    const reused = await writeImmutableJson(revisionPath, run);
    const currentPointerPath = join(runRoot, "current.json");
    const pointer = {
      schema_version: "activation-run-pointer/v1",
      run_id: run.run_id,
      revision_id: revisionId
    };
    let pointerMatches = false;
    if (await pathExists(currentPointerPath)) {
      const current = JSON.parse(await readFile(currentPointerPath, "utf8"));
      pointerMatches = canonicalJson(current) === canonicalJson(pointer);
    }
    if (!pointerMatches) await atomicWriteJson(currentPointerPath, pointer);
    return {
      revision_id: revisionId,
      revision_path: revisionPath,
      current_pointer_path: currentPointerPath,
      reused
    };
  });
}

export { EVENT_DEFINITIONS, STATE_BY_REASON };
