import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_LOCK_PATTERN = /^lock:[a-f0-9]{64}$/;
const RADIO_PATTERN = /^radio:[a-f0-9]{64}$/;
const PACKET_PATTERN = /^packet:[a-f0-9]{64}$/;
const ROLES = new Set(["independent_designer", "simulated_user"]);
const REQUIRED_DIMENSIONS = [
  "orientation",
  "comprehension",
  "recall",
  "accessibility",
  "mascot_distraction",
  "caption_integrity"
];

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

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireSha256(value, label) {
  if (!SHA256_PATTERN.test(value ?? "")) throw new Error(`${label} must be a SHA-256 digest`);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
}

function neutralizeControlledTreatment(scene) {
  const clone = structuredClone(scene);
  clone.render_treatment = "CONTROLLED_HOST_OR_TITLE";
  clone.stage.kind = "CONTROLLED_HOST_OR_TITLE";
  clone.stage.host_count = "CONTROLLED_HOST_OR_TITLE";
  clone.caption.avatar = "CONTROLLED_HOST_OR_TITLE";
  clone.motion.envelope = "CONTROLLED_HOST_OR_TITLE";
  clone.motion.wing = "CONTROLLED_HOST_OR_TITLE";
  return clone;
}

function validateControlledCandidates(baseline, mixed) {
  if (baseline?.variant !== "baseline" || mixed?.variant !== "mixed") {
    throw new Error("comparison candidates must be the baseline and mixed renderer models");
  }
  const sharedKeys = [
    "schema_version",
    "production_id",
    "production_version",
    "scope",
    "status",
    "patient_ready",
    "generated_media_state",
    "reduced_motion",
    "compact_avatar",
    "caption_contract",
    "layout_profiles"
  ];
  for (const key of sharedKeys) {
    if (canonicalJson(baseline[key]) !== canonicalJson(mixed[key])) {
      throw new Error(`controlled comparison drifted outside treatment: ${key}`);
    }
  }
  if (baseline.scenes?.length !== 3 || mixed.scenes?.length !== 3) {
    throw new Error("controlled comparison requires exactly three scenes");
  }
  for (let index = 0; index < baseline.scenes.length; index += 1) {
    const left = baseline.scenes[index];
    const right = mixed.scenes[index];
    if (left.scene_id !== right.scene_id) throw new Error("controlled comparison scene order drifted");
    if (index === 1) {
      if (canonicalJson(left) !== canonicalJson(right)) {
        throw new Error("programming treatment, caption, copy, diagram, timing, or motion drifted");
      }
      continue;
    }
    if (left.render_treatment !== "baseline" || right.render_treatment !== "host_led") {
      throw new Error(`${left.scene_id}: controlled treatment assignment drifted`);
    }
    if (canonicalJson(neutralizeControlledTreatment(left)) !== canonicalJson(neutralizeControlledTreatment(right))) {
      throw new Error(`${left.scene_id}: caption, copy, timing, canvas input, or non-treatment field drifted`);
    }
  }
}

export function buildAnimaticComparisonManifest({
  runId,
  contentLockId,
  radioBundleId,
  radioCutSha256,
  timelineSha256,
  storyboardSha256,
  wordTimingsSha256,
  canvas,
  renderEnvironment,
  baseline,
  mixed,
  illustrationSha256
}) {
  validateControlledCandidates(baseline, mixed);
  const identity = canonicalValue({
    run_id: runId,
    content_lock_id: contentLockId,
    radio_bundle_id: radioBundleId,
    radio_cut_sha256: radioCutSha256,
    timeline_sha256: timelineSha256,
    storyboard_sha256: storyboardSha256,
    word_timings_sha256: wordTimingsSha256,
    illustration_sha256: illustrationSha256,
    canvas,
    render_environment: renderEnvironment,
    candidates: { baseline, mixed },
    motion_envelope_contract: {
      baseline: "token_beak_restrained_head",
      mixed_host: "token_beak_head_single_wing",
      programming: "token_beak_restrained_head",
      carries_clinical_meaning: false
    },
    review_facing: {
      labels: ["Candidate A", "Candidate B"],
      balanced_orders: [
        ["Candidate A", "Candidate B"],
        ["Candidate B", "Candidate A"]
      ],
      require_both_completed_before_rubric: true,
      replay_available: true,
      implementation_rationale_exposed: false,
      private_concept_only: true,
      patient_ready: false
    }
  });
  const comparisonSha256 = sha256(canonicalJson(identity));
  const manifest = {
    schema_version: "activation-animatic-comparison/v1",
    comparison_id: `comparison:${comparisonSha256}`,
    comparison_sha256: comparisonSha256,
    ...identity
  };
  validateAnimaticComparisonManifest(manifest);
  return manifest;
}

export function validateAnimaticComparisonManifest(manifest) {
  if (manifest?.schema_version !== "activation-animatic-comparison/v1") {
    throw new Error("unsupported activation animatic comparison schema");
  }
  requireString(manifest.run_id, "run_id");
  if (!CONTENT_LOCK_PATTERN.test(manifest.content_lock_id ?? "")) throw new Error("content lock is invalid");
  if (!RADIO_PATTERN.test(manifest.radio_bundle_id ?? "")) throw new Error("radio bundle is invalid");
  for (const [label, value] of [
    ["radio cut", manifest.radio_cut_sha256],
    ["timeline", manifest.timeline_sha256],
    ["timed storyboard", manifest.storyboard_sha256],
    ["word timings", manifest.word_timings_sha256],
    ["illustration", manifest.illustration_sha256]
  ]) requireSha256(value, `${label} hash`);
  if (
    manifest.canvas?.width !== 1280 ||
    manifest.canvas?.height !== 720 ||
    manifest.canvas?.fps !== 30
  ) throw new Error("comparison canvas must be locked to 1280x720 at 30 fps");
  if (
    !manifest.render_environment?.browser ||
    !manifest.render_environment?.os ||
    manifest.render_environment?.device_pixel_ratio !== 1
  ) throw new Error("render environment fingerprint is incomplete");
  validateControlledCandidates(manifest.candidates?.baseline, manifest.candidates?.mixed);
  if (
    manifest.motion_envelope_contract?.baseline !== "token_beak_restrained_head" ||
    manifest.motion_envelope_contract?.mixed_host !== "token_beak_head_single_wing" ||
    manifest.motion_envelope_contract?.programming !== "token_beak_restrained_head" ||
    manifest.motion_envelope_contract?.carries_clinical_meaning !== false
  ) throw new Error("mixed animatic motion envelope drifted");
  const reviewJson = canonicalJson(manifest.review_facing);
  if (/baseline|mixed|host[-_ ]led|title[-_ ]card/i.test(reviewJson)) {
    throw new Error("review-facing comparison reveals treatment labels");
  }
  if (
    canonicalJson(manifest.review_facing?.labels) !== canonicalJson(["Candidate A", "Candidate B"]) ||
    manifest.review_facing?.require_both_completed_before_rubric !== true ||
    manifest.review_facing?.replay_available !== true ||
    manifest.review_facing?.implementation_rationale_exposed !== false ||
    manifest.review_facing?.private_concept_only !== true ||
    manifest.review_facing?.patient_ready !== false
  ) throw new Error("neutral review flow is incomplete");
  const { schema_version, comparison_id, comparison_sha256, ...identity } = manifest;
  void schema_version;
  const actual = sha256(canonicalJson(identity));
  if (actual !== comparison_sha256 || comparison_id !== `comparison:${actual}`) {
    throw new Error("comparison identity does not match its controlled inputs");
  }
  return true;
}

const DENIED_SEGMENTS = new Set([
  ".git",
  ".production",
  ".env",
  ".env.local",
  "secrets",
  "credentials"
]);

export function authorizeCaptureRequest({ method, host, url, token, policy }) {
  const deny = (reason) => ({ allowed: false, reason });
  if (!policy || !Number.isInteger(policy.port) || typeof policy.token !== "string") {
    return deny("invalid_policy");
  }
  if (method !== "GET" && method !== "HEAD") return deny("method_denied");
  if (host !== `127.0.0.1:${policy.port}`) return deny("host_denied");
  if (token !== policy.token) return deny("token_denied");
  let parsed;
  try {
    parsed = new URL(url, "http://127.0.0.1");
  } catch {
    return deny("malformed_url");
  }
  let decoded;
  try {
    decoded = decodeURIComponent(parsed.pathname);
  } catch {
    return deny("malformed_path");
  }
  const segments = decoded.split("/").filter(Boolean);
  if (
    decoded.includes("\\") ||
    segments.includes("..") ||
    segments.some((segment) => DENIED_SEGMENTS.has(segment.toLowerCase()) || segment.startsWith("."))
  ) return deny("path_denied");
  if (!policy.allowedPaths?.has(decoded)) return deny("path_not_allowlisted");
  return { allowed: true, path: decoded };
}

export function createReviewChallenge({
  packetId,
  role,
  evaluatorId,
  artifactHashes,
  reviewerPromptHash,
  rubricVersion,
  model,
  inferenceConfiguration,
  allowedToolPolicy
}) {
  if (!PACKET_PATTERN.test(packetId ?? "")) throw new Error("review packet id is invalid");
  if (!ROLES.has(role)) throw new Error("review role is invalid");
  requireString(evaluatorId, "evaluator id");
  requireSha256(reviewerPromptHash, "reviewer prompt hash");
  requireString(rubricVersion, "rubric version");
  requireString(model, "review model");
  if (!artifactHashes || Object.keys(artifactHashes).length < 2) {
    throw new Error("review challenge must bind both candidate artifact hashes");
  }
  for (const [name, hash] of Object.entries(artifactHashes)) requireSha256(hash, `${name} artifact hash`);
  if (!Array.isArray(allowedToolPolicy) || allowedToolPolicy.length === 0) {
    throw new Error("review challenge must record an allowed-tool policy");
  }
  const token = randomBytes(32).toString("hex");
  const identity = canonicalValue({
    packet_id: packetId,
    role,
    evaluator_id: evaluatorId,
    artifact_hashes: artifactHashes,
    reviewer_prompt_hash: reviewerPromptHash,
    rubric_version: rubricVersion,
    model,
    inference_configuration: inferenceConfiguration,
    allowed_tool_policy: allowedToolPolicy,
    challenge_token_sha256: sha256(token)
  });
  const challenge = {
    schema_version: "activation-review-challenge/v1",
    challenge_id: `challenge:${sha256(canonicalJson(identity))}`,
    ...identity,
    consumed: false
  };
  return { challenge, token };
}

function safeTokenMatch(token, expectedHash) {
  if (typeof token !== "string" || !SHA256_PATTERN.test(expectedHash ?? "")) return false;
  const actual = Buffer.from(sha256(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}

export function validateReviewReceipt({ challenge, receipt }) {
  if (challenge?.schema_version !== "activation-review-challenge/v1" || challenge.consumed === true) {
    throw new Error("review challenge is invalid or already consumed");
  }
  if (receipt?.schema_version !== "activation-review-receipt/v1") {
    throw new Error("review receipt schema is invalid");
  }
  if (receipt.challenge_id !== challenge.challenge_id) throw new Error("receipt challenge identity drifted");
  if (!safeTokenMatch(receipt.challenge_token, challenge.challenge_token_sha256)) {
    throw new Error("receipt challenge token is invalid");
  }
  for (const [field, label] of [
    ["packet_id", "packet"],
    ["role", "role"],
    ["evaluator_id", "evaluator"],
    ["reviewer_prompt_hash", "reviewer prompt"],
    ["rubric_version", "rubric"],
    ["model", "model"]
  ]) {
    if (canonicalJson(receipt[field]) !== canonicalJson(challenge[field])) {
      throw new Error(`review receipt ${label} drifted from its challenge`);
    }
  }
  for (const [field, label] of [
    ["inference_configuration", "inference configuration"],
    ["allowed_tool_policy", "allowed tool policy"],
    ["artifact_hashes", "artifact hashes"]
  ]) {
    if (canonicalJson(receipt[field]) !== canonicalJson(challenge[field])) {
      throw new Error(`review receipt ${label} drifted from its challenge`);
    }
  }
  const events = receipt.viewing_events;
  if (!Array.isArray(events) || events.some((event, index) => event.sequence !== index + 1)) {
    throw new Error("review viewing events must be an ordered append-only sequence");
  }
  const completionA = events.findIndex((event) => event.event === "completed" && event.candidate === "Candidate A");
  const completionB = events.findIndex((event) => event.event === "completed" && event.candidate === "Candidate B");
  const rubric = events.findIndex((event) => event.event === "rubric_revealed");
  const scored = events.findIndex((event) => event.event === "scored");
  if (
    completionA < 0 || completionB < 0 || rubric < completionA || rubric < completionB ||
    scored < rubric
  ) throw new Error("both candidates must be viewed before the rubric is revealed or scored");
  if (!receipt.dimensions || REQUIRED_DIMENSIONS.some((dimension) => !receipt.dimensions[dimension])) {
    throw new Error("review receipt is missing required dimensions");
  }
  if (!Array.isArray(receipt.critical_failures) || !Array.isArray(receipt.findings)) {
    throw new Error("review receipt findings are incomplete");
  }
  if (!new Set(["pass", "fail"]).has(receipt.disposition)) {
    throw new Error("review receipt disposition must be pass or fail");
  }
  if (receipt.disposition === "pass" && receipt.critical_failures.length > 0) {
    throw new Error("a receipt with critical failures cannot pass");
  }
  return true;
}

export { REQUIRED_DIMENSIONS };
