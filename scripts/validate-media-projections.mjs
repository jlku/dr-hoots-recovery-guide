import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const canonical = JSON.parse(await readFile(new URL("../content/canonical/ci-phase0-v0.1.0.json", import.meta.url), "utf8"));
const sceneSource = JSON.parse(await readFile(new URL("../content/scenes/ci-phase0-v0.1.0.scenes.json", import.meta.url), "utf8"));
const projection = JSON.parse(await readFile(new URL("../content/generated/ci-phase0-v0.1.0.media.json", import.meta.url), "utf8"));
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

const expectedModules = canonical.modules.map(({ id }) => id);
const expectedSentences = canonical.modules.flatMap((module) => module.canonical_sentences.map(({ id }) => id));
const expectedFormats = ["linear_video", "chaptered_video", "scroll_guide"];
const formats = Object.entries(projection.formats);
const canonicalModules = new Map(canonical.modules.map((module) => [module.id, module]));
const canonicalSentences = new Map(canonical.modules.flatMap((module) => module.canonical_sentences.map((sentence) => [sentence.id, { ...sentence, module_id: module.id }])));
const canonicalClaims = new Set(canonical.sources.flatMap((source) => source.claims.map(({ id }) => id)));
const expectedSceneIds = sceneSource.scenes.map(({ id }) => id);
const expectedProjectedModules = canonical.modules.map((module) => ({
  module_id: module.id,
  module_version: module.version,
  content_sha256: module.content_sha256,
  sentence_ids: module.canonical_sentences.map(({ id }) => id),
  clinical_visual_status: "blocked_pending_surgeon_review"
}));
const requiredChannel = (mode) => ({ required: true, mode, sentence_ids: expectedSentences });
const unusedChannel = (mode) => ({ required: false, mode, sentence_ids: [] });
const expectedChannels = {
  linear_video: {
    visible_text: requiredChannel("live_html_from_canonical"),
    captions: requiredChannel("webvtt_from_canonical"),
    transcript: requiredChannel("live_html_from_canonical"),
    narration_or_audio_description: requiredChannel("complete_audio_track_from_canonical")
  },
  chaptered_video: {
    visible_text: requiredChannel("live_html_from_canonical"),
    captions: requiredChannel("webvtt_from_canonical"),
    transcript: requiredChannel("live_html_from_canonical"),
    narration_or_audio_description: requiredChannel("complete_audio_track_from_canonical")
  },
  scroll_guide: {
    visible_text: requiredChannel("semantic_html_from_canonical"),
    captions: unusedChannel("not_applicable_without_timed_media"),
    transcript: requiredChannel("semantic_document_is_transcript"),
    narration_or_audio_description: unusedChannel("not_required_without_timed_media")
  }
};

assert(projection.generated_from.artifact_id === canonical.artifact.id, "Artifact ID drifted");
assert(projection.generated_from.artifact_version === canonical.artifact.version, "Artifact version drifted");
assert(projection.generated_from.status === "unverified_draft", "Projection lost unverified status");
assert(projection.generated_from.patient_use === false, "Projection may not be patient-ready");
assert(projection.generated_from.notice === "UNVERIFIED — NOT FOR PATIENT USE", "Projection notice drifted");
assert(JSON.stringify(Object.keys(projection.formats)) === JSON.stringify(expectedFormats), "Exact three format keys are required");
assert(JSON.stringify(projection.allowed_format_differences) === JSON.stringify(["navigation", "pacing", "motion"]), "Allowed format differences drifted");
assert(sceneSource.artifact_id === canonical.artifact.id && sceneSource.artifact_version === canonical.artifact.version, "Scene manifest version drifted from canonical content");
assert(sceneSource.status === "unverified_draft" && sceneSource.patient_use === false, "Scene manifest lost draft-only safeguards");
assert(JSON.stringify(sceneSource.presentation_order) === JSON.stringify(expectedModules), "Scene presentation order drifted");

assert(JSON.stringify(projection.shared_modules) === JSON.stringify(expectedProjectedModules), "Shared modules must be one exact, ordered, unique canonical projection");
for (const projectedModule of projection.shared_modules) {
  const canonicalModule = canonicalModules.get(projectedModule.module_id);
  assert(Boolean(canonicalModule), `${projectedModule.module_id}: projected module is not canonical`);
  if (!canonicalModule) continue;
  assert(projectedModule.module_version === canonicalModule.version, `${projectedModule.module_id}: version drifted`);
  assert(projectedModule.content_sha256 === canonicalModule.content_sha256, `${projectedModule.module_id}: content hash drifted`);
  assert(JSON.stringify(projectedModule.sentence_ids) === JSON.stringify(canonicalModule.canonical_sentences.map(({ id }) => id)), `${projectedModule.module_id}: sentence sequence drifted`);
  assert(projectedModule.clinical_visual_status === "blocked_pending_surgeon_review", `${projectedModule.module_id}: clinical visual status was unblocked`);
}

const seenSceneIds = new Set();
const seenSentenceIds = [];
for (const scene of sceneSource.scenes) {
  assert(!seenSceneIds.has(scene.id), `${scene.id}: duplicate scene ID`);
  seenSceneIds.add(scene.id);
  const canonicalModule = canonicalModules.get(scene.module_id);
  assert(Boolean(canonicalModule), `${scene.id}: unknown module ${scene.module_id}`);
  assert(scene.target_seconds > 0, `${scene.id}: target_seconds must be positive`);
  const expectedClaimIds = new Set();
  for (const sentenceId of scene.sentence_ids) {
    const sentence = canonicalSentences.get(sentenceId);
    assert(Boolean(sentence), `${scene.id}: unknown sentence ${sentenceId}`);
    if (!sentence) continue;
    assert(sentence.module_id === scene.module_id, `${scene.id}: sentence ${sentenceId} belongs to another module`);
    seenSentenceIds.push(sentenceId);
    sentence.source_claim_ids.forEach((claimId) => expectedClaimIds.add(claimId));
  }
  assert(scene.source_claim_ids.every((claimId) => canonicalClaims.has(claimId)), `${scene.id}: unknown scene claim mapping`);
  assert([...expectedClaimIds].every((claimId) => scene.source_claim_ids.includes(claimId)), `${scene.id}: scene claim mapping is incomplete`);
  const visual = scene.visual;
  assert(Boolean(visual) && Array.isArray(visual.source_claim_ids), `${scene.id}: visual contract is missing`);
  if (!visual) continue;
  assert(visual.source_claim_ids.every((claimId) => canonicalClaims.has(claimId)), `${scene.id}: visual has an unknown claim mapping`);
  assert(visual.source_claim_ids.every((claimId) => scene.source_claim_ids.includes(claimId)), `${scene.id}: visual claim is outside the scene`);
  assert(Boolean(visual.static_fallback), `${scene.id}: static fallback is missing`);
  assert(Boolean(visual.essential_visual_description), `${scene.id}: essential visual description is missing`);
  assert(Boolean(visual.motion_policy), `${scene.id}: motion policy is missing`);
  assert(Boolean(visual.reduced_motion_policy), `${scene.id}: reduced-motion policy is missing`);
  assert(["blocked_pending_surgeon_review", "surgeon_approved"].includes(visual.review_status), `${scene.id}: visual review status is missing or invalid`);
  if (visual.review_status === "surgeon_approved") {
    const approval = visual.clinical_approval;
    assert(visual.renderable === true, `${scene.id}: approved visual must be explicitly renderable`);
    assert(typeof visual.asset_id === "string" && visual.asset_id.length > 0, `${scene.id}: approved visual needs an asset ID`);
    assert(/^[a-f0-9]{64}$/.test(visual.asset_sha256 ?? ""), `${scene.id}: approved visual needs an asset hash`);
    assert(Boolean(approval), `${scene.id}: approved visual needs clinical approval evidence`);
    if (approval) {
      assert(typeof approval.approver_id === "string" && approval.approver_id.length > 0, `${scene.id}: clinical approver identity is missing`);
      assert(!Number.isNaN(Date.parse(approval.approved_at)), `${scene.id}: clinical approval timestamp is missing or invalid`);
      assert(approval.artifact_id === canonical.artifact.id, `${scene.id}: clinical approval is bound to another artifact`);
      assert(approval.artifact_version === canonical.artifact.version, `${scene.id}: clinical approval is bound to another version`);
      assert(approval.scene_id === scene.id, `${scene.id}: clinical approval is bound to another scene`);
      assert(approval.asset_sha256 === visual.asset_sha256, `${scene.id}: clinical approval is bound to another asset hash`);
      assert(JSON.stringify(approval.source_claim_ids) === JSON.stringify(visual.source_claim_ids), `${scene.id}: clinical approval is not bound to the exact visual claims`);
    }
  } else {
    assert(visual.renderable === false, `${scene.id}: unapproved visual is renderable`);
    assert(visual.asset_id === null, `${scene.id}: unapproved visual references an asset`);
    assert(visual.asset_sha256 == null, `${scene.id}: unapproved visual references an asset hash`);
    assert(visual.clinical_approval == null, `${scene.id}: blocked visual carries approval evidence`);
  }
}
assert(JSON.stringify(seenSentenceIds) === JSON.stringify(expectedSentences), "Scene sentence coverage or order drifted");
assert(JSON.stringify(projection.shared_scenes) === JSON.stringify(sceneSource.scenes), "Generated scene manifest drifted from its source");

for (const [format, settings] of formats) {
  assert(JSON.stringify(settings.module_ids) === JSON.stringify(expectedModules), `${format}: module order drifted`);
  assert(JSON.stringify(settings.sentence_ids) === JSON.stringify(expectedSentences), `${format}: sentence order drifted`);
  assert(JSON.stringify(settings.scene_ids) === JSON.stringify(expectedSceneIds), `${format}: scene order drifted`);
  assert(JSON.stringify(settings.channels) === JSON.stringify(expectedChannels[format]), `${format}: exact channel keys, modes, required flags, and sentence projections are required`);
}

assert(projection.formats.linear_video.navigation === "global_progress_no_topic_chooser", "Linear navigation policy changed");
assert(projection.formats.chaptered_video.navigation === "direct_topic_access", "Chaptered navigation policy changed");
assert(projection.formats.scroll_guide.navigation === "semantic_document_order", "Scroll navigation policy changed");
assert(projection.formats.linear_video.media_asset_policy === "same_scene_assets_as_chaptered_video", "Linear video asset-sharing rule changed");
assert(projection.formats.chaptered_video.media_asset_policy === "same_scene_assets_as_linear_video", "Chaptered video asset-sharing rule changed");
assert(JSON.stringify(projection.formats.linear_video.scene_ids) === JSON.stringify(projection.formats.chaptered_video.scene_ids), "Video formats no longer share the same scenes");
for (const format of ["linear_video", "chaptered_video"]) {
  const settings = projection.formats[format];
  assert(settings.target_seconds <= settings.timing_budget_seconds, `${format}: exceeds timing budget`);
  assert(settings.timing_budget_seconds === 180, `${format}: under-three-minute budget is missing`);
  assert(settings.channels.narration_or_audio_description.required === true, `${format}: complete narration or audio description is required`);
}

const projectedText = JSON.stringify(projection);
for (const { text } of canonicalSentences.values()) {
  assert(!projectedText.includes(text), "Projection copied a clinical string instead of resolving its sentence ID");
}

const { projection_sha256: recordedHash, ...hashBasis } = projection;
const computedHash = createHash("sha256").update(JSON.stringify(hashBasis)).digest("hex");
assert(recordedHash === computedHash, "Projection hash mismatch");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Media projections valid: ${formats.length} formats, ${expectedSentences.length} sentence IDs, zero copied clinical strings.`);
