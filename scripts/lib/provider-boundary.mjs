import { createHash } from "node:crypto";

export const MODEL_ID = "fal-ai/kling-video/ai-avatar/v2/standard";
export const COST_PER_SECOND_USD = 0.0562;
export const PROVIDER_SPEND_CAP_USD = 15;
export const ATTEMPT_LIMIT = 3;
export const MEDIA_EXPIRATION_SECONDS = 3600;
export const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;

const HOST_SCENES = Object.freeze([
  {
    scene_id: "scene/activation/healing",
    performance_id: "host/healing",
    narration_id: "healing",
    gesture_envelope: "one brief welcoming wing opening, then a neutral hold",
    prompt:
      "Locked camera. Dr. Hoots, the same clay owl in teal scrubs, speaks the supplied narration with clear restrained beak movement and a friendly attentive expression. Use one brief welcoming wing opening near the start, then keep both wings settled. Preserve the exact eyes, beak, feathers, proportions, scrubs, pin, pockets, feet, pale blue background, framing, and lighting. No pointing, ear touching, device touching, clinical demonstration, repeated waving, extra limbs, hands, morphing, camera motion, text, or background motion."
  },
  {
    scene_id: "scene/activation/follow-up",
    performance_id: "host/follow-up",
    narration_id: "follow-up",
    gesture_envelope: "one small invitation wing opening near keep returning, otherwise neutral",
    prompt:
      "Locked camera. Dr. Hoots, the same clay owl in teal scrubs, speaks the supplied narration with clear restrained beak movement, subtle natural head motion, and a calm attentive expression. Use one small invitation wing opening only near the words keep returning, then settle immediately. Preserve the exact eyes, beak, feathers, proportions, scrubs, pin, pockets, feet, pale blue background, framing, and lighting. No pointing, ear touching, device touching, clinical demonstration, repeated waving, extra limbs, hands, morphing, camera motion, text, or background motion."
  }
]);

const TERMINAL_STATES = new Set([
  "unknown_unreconcilable",
  "provider_failed",
  "approved",
  "rejected"
]);

const TRANSITIONS = Object.freeze({
  reserved: {
    submit_started: "submitted"
  },
  submitted: {
    provider_request_received: "provider_pending",
    submit_outcome_unknown: "unknown_unreconcilable"
  },
  provider_pending: {
    provider_succeeded: "succeeded_unreviewed",
    provider_failed: "provider_failed"
  },
  succeeded_unreviewed: {
    review_approved: "approved",
    review_rejected: "rejected"
  }
});

export const PROVIDER_POLICY_RECORD = Object.freeze({
  schema_version: "activation-provider-policy/v1",
  provider: "fal",
  model_id: MODEL_ID,
  verified_on: "2026-08-23",
  input_retention: {
    request_json_storage: "disabled_per_request",
    uploaded_media_expiration_seconds: MEDIA_EXPIRATION_SECONDS
  },
  output_retention: {
    request_json_storage: "disabled_per_request",
    generated_media_expiration_seconds: MEDIA_EXPIRATION_SECONDS
  },
  deletion_and_controls: {
    request_header: "X-Fal-Store-IO: 0",
    media_lifecycle_header: "X-Fal-Object-Lifecycle-Preference",
    local_download_required_before_expiration: true
  },
  model_training_use: {
    customer_input_license: "service_provision",
    usage_data_may_support_service_and_model_improvement: true,
    compatibility_scope: "private_non_patient_character_and_provisional_narration_only"
  },
  sources: [
    "https://fal.ai/docs/documentation/model-apis/media-expiration",
    "https://fal.ai/docs/documentation/model-apis/common-parameters",
    "https://fal.ai/legal/terms-of-service",
    "https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard/api"
  ]
});

function clone(value) {
  return structuredClone(value);
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(label + " is required");
  }
}

function requirePositiveNumber(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(label + " must be positive");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function calculateMaximumCostUsd(durationSeconds) {
  requirePositiveNumber(durationSeconds, "durationSeconds");
  return Math.ceil(durationSeconds * COST_PER_SECOND_USD * 100) / 100;
}

export function buildProviderHeaders() {
  return {
    "X-Fal-Object-Lifecycle-Preference": JSON.stringify({
      expiration_duration_seconds: MEDIA_EXPIRATION_SECONDS
    }),
    "X-Fal-Store-IO": "0"
  };
}

export function submissionGateForRun(run) {
  if (
    run?.stage === "motion_generation" &&
    run?.status === "partial" &&
    run?.reason_code === "host_performances_required" &&
    run?.resume_action === "generate_next_host_performance"
  ) {
    return { allowed: true, reason_code: null };
  }
  return {
    allowed: false,
    reason_code: run?.reason_code ?? "production_run_not_ready"
  };
}

export function buildHostSubmissionPlan({
  run,
  contentLockId,
  radioBundleId,
  imagePath,
  scenes
}) {
  requireNonEmptyString(contentLockId, "contentLockId");
  requireNonEmptyString(radioBundleId, "radioBundleId");
  requireNonEmptyString(imagePath, "imagePath");
  if (!Array.isArray(scenes)) throw new Error("scenes are required");
  const bySceneId = new Map(scenes.map((scene) => [scene.scene_id, scene]));
  const performances = HOST_SCENES.map((definition) => {
    const scene = bySceneId.get(definition.scene_id);
    if (!scene || scene.narration_id !== definition.narration_id) {
      throw new Error("approved host scene is missing or drifted: " + definition.scene_id);
    }
    requirePositiveNumber(scene.duration_seconds, definition.performance_id + " duration");
    const maximumCost = calculateMaximumCostUsd(scene.duration_seconds);
    return {
      ...clone(definition),
      duration_seconds: scene.duration_seconds,
      maximum_cost_usd: maximumCost,
      image_path: imagePath,
      audio_path: "assets/audio/" + definition.narration_id + ".mp3",
      content_lock_id: contentLockId,
      radio_bundle_id: radioBundleId
    };
  });
  const gate = submissionGateForRun(run);
  return {
    schema_version: "activation-host-submission-plan/v1",
    provider: "fal",
    model_id: MODEL_ID,
    provider_call_allowed: gate.allowed,
    block_reason: gate.reason_code,
    performances,
    maximum_first_pass_cost_usd: roundMoney(
      performances.reduce((sum, performance) => sum + performance.maximum_cost_usd, 0)
    ),
    provider_spend_cap_usd: PROVIDER_SPEND_CAP_USD,
    attempt_limit_per_performance: ATTEMPT_LIMIT,
    retention: clone(PROVIDER_POLICY_RECORD),
    request_headers: buildProviderHeaders(),
    patient_ready: false,
    private_concept_only: true
  };
}

export function createSpendLedger({ configuredCapUsd = PROVIDER_SPEND_CAP_USD } = {}) {
  requirePositiveNumber(configuredCapUsd, "configuredCapUsd");
  if (configuredCapUsd > PROVIDER_SPEND_CAP_USD) {
    throw new Error("configured spend cap exceeds the production hard cap");
  }
  return {
    schema_version: "activation-provider-spend-ledger/v1",
    configured_cap_usd: roundMoney(configuredCapUsd),
    accepted_cap_usd: null,
    authorized: false,
    acceptance_evidence: null,
    attempts: [],
    held_reservations: [],
    committed_spend_usd: 0
  };
}

export function authorizeSpendLedger(ledger, { acceptedCapUsd, acceptanceEvidence }) {
  if (ledger?.schema_version !== "activation-provider-spend-ledger/v1") {
    throw new Error("spend ledger is invalid");
  }
  requirePositiveNumber(acceptedCapUsd, "acceptedCapUsd");
  requireNonEmptyString(acceptanceEvidence, "acceptanceEvidence");
  if (acceptedCapUsd > ledger.configured_cap_usd || acceptedCapUsd > PROVIDER_SPEND_CAP_USD) {
    throw new Error("accepted spend cap exceeds the configured hard cap");
  }
  if (ledger.authorized) {
    if (
      ledger.accepted_cap_usd === roundMoney(acceptedCapUsd) &&
      ledger.acceptance_evidence === acceptanceEvidence
    ) return ledger;
    throw new Error("spend authorization is immutable");
  }
  return {
    ...clone(ledger),
    accepted_cap_usd: roundMoney(acceptedCapUsd),
    authorized: true,
    acceptance_evidence: acceptanceEvidence
  };
}

function reservedTotal(ledger) {
  return ledger.held_reservations.reduce(
    (sum, reservation) =>
      sum +
      Math.max(
        0,
        reservation.maximum_cost_usd - (reservation.actual_cost_usd ?? 0)
      ),
    0
  );
}

export function reserveProviderAttempt(
  ledger,
  { performanceId, durationSeconds, clientIdempotencyKey }
) {
  if (ledger?.schema_version !== "activation-provider-spend-ledger/v1") {
    throw new Error("spend ledger is invalid");
  }
  if (!ledger.authorized || ledger.accepted_cap_usd === null) {
    throw new Error("provider spend authorization is required before reservation");
  }
  requireNonEmptyString(performanceId, "performanceId");
  requirePositiveNumber(durationSeconds, "durationSeconds");
  requireNonEmptyString(clientIdempotencyKey, "clientIdempotencyKey");

  const priorByKey = ledger.attempts.find(
    (attempt) => attempt.client_idempotency_key === clientIdempotencyKey
  );
  if (priorByKey) {
    if (priorByKey.performance_id !== performanceId) {
      throw new Error("client idempotency key is already bound to another performance");
    }
    return { ledger, reservation: priorByKey, reused: true };
  }

  const attemptsForPerformance = ledger.attempts.filter(
    (attempt) => attempt.performance_id === performanceId
  );
  if (attemptsForPerformance.length >= ATTEMPT_LIMIT) {
    throw new Error("provider attempt limit reached for " + performanceId);
  }

  const maximumCost = calculateMaximumCostUsd(durationSeconds);
  if (
    roundMoney(ledger.committed_spend_usd + reservedTotal(ledger) + maximumCost) >
    ledger.accepted_cap_usd
  ) {
    throw new Error("provider spend cap would be exceeded by this reservation");
  }

  const identity = JSON.stringify({
    performance_id: performanceId,
    attempt_number: attemptsForPerformance.length + 1,
    client_idempotency_key: clientIdempotencyKey,
    maximum_cost_usd: maximumCost
  });
  const reservation = {
    schema_version: "activation-provider-attempt/v1",
    reservation_id: "reservation:" + sha256(identity),
    performance_id: performanceId,
    attempt_number: attemptsForPerformance.length + 1,
    client_idempotency_key: clientIdempotencyKey,
    maximum_cost_usd: maximumCost,
    expected_duration_seconds: durationSeconds,
    model_id: MODEL_ID,
    state: "reserved",
    provider_request_id: null,
    actual_cost_usd: null,
    transitions: [{ sequence: 1, event: "reserved", state: "reserved" }]
  };
  const next = {
    ...clone(ledger),
    attempts: [...clone(ledger.attempts), reservation],
    held_reservations: [...clone(ledger.held_reservations), reservation]
  };
  return { ledger: next, reservation, reused: false };
}

export function transitionProviderAttempt(
  ledger,
  { reservationId, event, providerRequestId = null, actualCostUsd = null }
) {
  const index = ledger?.attempts?.findIndex(
    (attempt) => attempt.reservation_id === reservationId
  );
  if (!Number.isInteger(index) || index < 0) throw new Error("provider reservation is unknown");
  const current = ledger.attempts[index];
  if (TERMINAL_STATES.has(current.state)) {
    throw new Error("provider attempt is terminal and cannot transition");
  }
  const nextState = TRANSITIONS[current.state]?.[event];
  if (!nextState) {
    throw new Error("invalid provider attempt transition: " + current.state + " -> " + event);
  }
  if (event === "provider_request_received") {
    requireNonEmptyString(providerRequestId, "providerRequestId");
  }
  if (event === "provider_succeeded") {
    requirePositiveNumber(actualCostUsd, "actualCostUsd");
    if (actualCostUsd > current.maximum_cost_usd) {
      throw new Error("provider actual cost exceeds its reservation");
    }
  }
  const updated = {
    ...clone(current),
    state: nextState,
    provider_request_id:
      providerRequestId ?? current.provider_request_id,
    actual_cost_usd:
      actualCostUsd ?? current.actual_cost_usd,
    transitions: [
      ...clone(current.transitions),
      {
        sequence: current.transitions.length + 1,
        event,
        state: nextState,
        ...(providerRequestId ? { provider_request_id: providerRequestId } : {}),
        ...(actualCostUsd ? { actual_cost_usd: actualCostUsd } : {})
      }
    ]
  };
  const attempts = clone(ledger.attempts);
  attempts[index] = updated;
  const knownTerminal = new Set(["provider_failed", "approved", "rejected"]);
  const heldReservations = knownTerminal.has(nextState)
    ? ledger.held_reservations.filter(
        (reservation) => reservation.reservation_id !== reservationId
      )
    : ledger.held_reservations.map((reservation) =>
        reservation.reservation_id === reservationId ? updated : reservation
      );
  const committedSpend =
    event === "provider_succeeded"
      ? roundMoney(ledger.committed_spend_usd + actualCostUsd)
      : ledger.committed_spend_usd;
  return {
    ledger: {
      ...clone(ledger),
      attempts,
      held_reservations: heldReservations,
      committed_spend_usd: committedSpend
    },
    reservation: updated
  };
}

export function validateProviderDownloadUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("provider download URL is malformed");
  }
  if (url.protocol !== "https:") throw new Error("provider download URL must use HTTPS");
  if (url.username || url.password) throw new Error("provider download URL credentials are forbidden");
  if (url.port && url.port !== "443") throw new Error("provider download URL port is forbidden");
  const host = url.hostname.toLowerCase();
  if (!(host === "fal.media" || host.endsWith(".fal.media"))) {
    throw new Error("provider download host is not allowlisted");
  }
  return url;
}

export function inspectDownloadedVideoBytes({
  bytes,
  contentType,
  contentLength,
  maximumBytes = MAX_DOWNLOAD_BYTES
}) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error("downloaded video bytes are required");
  }
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength === 0 || buffer.byteLength > maximumBytes) {
    throw new Error("downloaded video exceeds the allowed size");
  }
  if (Number.isFinite(contentLength) && contentLength !== buffer.byteLength) {
    throw new Error("downloaded video content length drifted");
  }
  const normalizedType = String(contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!["video/mp4", "application/octet-stream"].includes(normalizedType)) {
    throw new Error("downloaded video content type is not allowed");
  }
  if (buffer.byteLength < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw new Error("downloaded video MP4 magic bytes are invalid");
  }
  return {
    container: "mp4",
    byte_length: buffer.byteLength,
    content_type: normalizedType,
    sha256: sha256(buffer)
  };
}

export function validateDownloadedDuration({
  expectedSeconds,
  actualSeconds,
  framesPerSecond
}) {
  requirePositiveNumber(expectedSeconds, "expectedSeconds");
  requirePositiveNumber(actualSeconds, "actualSeconds");
  requirePositiveNumber(framesPerSecond, "framesPerSecond");
  const tolerance = 1 / framesPerSecond;
  const delta = Math.abs(actualSeconds - expectedSeconds);
  if (delta > tolerance + 1e-6) {
    throw new Error(
      "downloaded video duration drift exceeds one frame: " + delta.toFixed(6) + "s"
    );
  }
  return {
    expected_seconds: expectedSeconds,
    actual_seconds: actualSeconds,
    delta_seconds: Number(delta.toFixed(6)),
    tolerance_seconds: Number(tolerance.toFixed(6)),
    within_tolerance: true
  };
}

function sanitizeString(value, secrets) {
  let result = value;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      result = result.split(secret).join("[REDACTED]");
    }
  }
  try {
    const url = new URL(result);
    if (url.protocol === "http:" || url.protocol === "https:") {
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  } catch {
    // Not a URL; continue with ordinary string redaction.
  }
  return result;
}

export function redactProviderData(value, { secrets = [] } = {}) {
  if (typeof value === "string") return sanitizeString(value, secrets);
  if (Array.isArray(value)) {
    return value.map((entry) => redactProviderData(entry, { secrets }));
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/authorization|credential|api[_-]?key|secret|token/i.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactProviderData(entry, { secrets });
      }
    }
    return result;
  }
  return value;
}
