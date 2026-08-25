import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const canonicalUrl = new URL("../content/canonical/ci-phase0-v0.1.0.json", import.meta.url);
const scenesUrl = new URL("../content/scenes/ci-phase0-v0.1.0.scenes.json", import.meta.url);
const outputUrl = new URL("../content/generated/ci-phase0-v0.1.0.media.json", import.meta.url);
const canonical = JSON.parse(await readFile(canonicalUrl, "utf8"));
const sceneSource = JSON.parse(await readFile(scenesUrl, "utf8"));

const modules = canonical.modules.map((module) => ({
  module_id: module.id,
  module_version: module.version,
  content_sha256: module.content_sha256,
  sentence_ids: module.canonical_sentences.map(({ id }) => id),
  clinical_visual_status: "blocked_pending_surgeon_review"
}));

const canonicalSequence = modules.flatMap(({ sentence_ids }) => sentence_ids);
const sceneIds = sceneSource.scenes.map(({ id }) => id);
const targetSeconds = sceneSource.scenes.reduce((sum, { target_seconds }) => sum + target_seconds, 0);
const requiredChannel = (mode) => ({ required: true, mode, sentence_ids: canonicalSequence });
const unusedChannel = (mode) => ({ required: false, mode, sentence_ids: [] });
const projection = {
  schema_version: "1.0",
  generated_from: {
    artifact_id: canonical.artifact.id,
    artifact_version: canonical.artifact.version,
    status: canonical.artifact.status,
    patient_use: canonical.artifact.patient_use,
    notice: canonical.artifact.notice
  },
  rule: "Resolve sentence text from the canonical artifact at view time. Projections contain IDs only.",
  allowed_format_differences: ["navigation", "pacing", "motion"],
  shared_modules: modules,
  shared_scenes: sceneSource.scenes,
  formats: {
    linear_video: {
      module_ids: modules.map(({ module_id }) => module_id),
      sentence_ids: canonicalSequence,
      scene_ids: sceneIds,
      navigation: "global_progress_no_topic_chooser",
      media_asset_policy: "same_scene_assets_as_chaptered_video",
      target_seconds: targetSeconds,
      timing_budget_seconds: 180,
      channels: {
        visible_text: requiredChannel("live_html_from_canonical"),
        captions: requiredChannel("webvtt_from_canonical"),
        transcript: requiredChannel("live_html_from_canonical"),
        narration_or_audio_description: requiredChannel("complete_audio_track_from_canonical")
      }
    },
    chaptered_video: {
      module_ids: modules.map(({ module_id }) => module_id),
      sentence_ids: canonicalSequence,
      scene_ids: sceneIds,
      navigation: "direct_topic_access",
      media_asset_policy: "same_scene_assets_as_linear_video",
      target_seconds: targetSeconds,
      timing_budget_seconds: 180,
      channels: {
        visible_text: requiredChannel("live_html_from_canonical"),
        captions: requiredChannel("webvtt_from_canonical"),
        transcript: requiredChannel("live_html_from_canonical"),
        narration_or_audio_description: requiredChannel("complete_audio_track_from_canonical")
      }
    },
    scroll_guide: {
      module_ids: modules.map(({ module_id }) => module_id),
      sentence_ids: canonicalSequence,
      scene_ids: sceneIds,
      navigation: "semantic_document_order",
      media_asset_policy: "same_approved_assets_and_static_keyframes",
      channels: {
        visible_text: requiredChannel("semantic_html_from_canonical"),
        captions: unusedChannel("not_applicable_without_timed_media"),
        transcript: requiredChannel("semantic_document_is_transcript"),
        narration_or_audio_description: unusedChannel("not_required_without_timed_media")
      }
    }
  }
};

const projectionBasis = JSON.stringify(projection);
projection.projection_sha256 = createHash("sha256").update(projectionBasis).digest("hex");

await mkdir(new URL("../content/generated/", import.meta.url), { recursive: true });
await writeFile(outputUrl, `${JSON.stringify(projection, null, 2)}\n`);
console.log(`Wrote ${outputUrl.pathname}`);
