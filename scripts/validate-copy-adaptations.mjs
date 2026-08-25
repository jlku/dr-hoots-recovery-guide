import { readFile } from "node:fs/promises";

const canonical = JSON.parse(await readFile(new URL("../content/canonical/ci-phase0-v0.1.0.json", import.meta.url), "utf8"));
const sceneSource = JSON.parse(await readFile(new URL("../content/scenes/ci-phase0-v0.1.0.scenes.json", import.meta.url), "utf8"));
const adaptation = JSON.parse(await readFile(new URL("../content/adaptations/activation-programming-v0.1.0.json", import.meta.url), "utf8"));
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };

const canonicalSentences = new Map(canonical.modules.flatMap((module) => module.canonical_sentences.map((sentence) => [sentence.id, sentence])));
const canonicalClaims = new Set(canonical.sources.flatMap((source) => source.claims.map((claim) => claim.id)));
const scene = sceneSource.scenes.find((candidate) => candidate.id === adaptation.scene_id);
const propositionIds = adaptation.propositions.map((proposition) => proposition.id);
const expectedFormats = ["linear_video", "chaptered_video", "scroll_guide"];

assert(adaptation.artifact_id === canonical.artifact.id, "Adaptation artifact ID drifted");
assert(adaptation.artifact_version === canonical.artifact.version, "Adaptation artifact version drifted");
assert(adaptation.status === "unverified_draft" && adaptation.patient_use === false, "Adaptation lost draft-only safeguards");
assert(adaptation.notice === "UNVERIFIED — NOT FOR PATIENT USE", "Adaptation notice drifted");
assert(Boolean(scene), "Adaptation scene is missing from the scene manifest");
if (scene) {
  assert(JSON.stringify(adaptation.canonical_sentence_ids) === JSON.stringify(scene.sentence_ids), "Adaptation must cover the exact scene sentence IDs");
  assert(JSON.stringify(adaptation.source_claim_ids) === JSON.stringify(scene.source_claim_ids), "Adaptation must carry the exact scene claim IDs");
}
assert(JSON.stringify(Object.keys(adaptation.formats)) === JSON.stringify(expectedFormats), "Exact adaptation format keys are required");
assert(new Set(propositionIds).size === propositionIds.length, "Proposition IDs must be unique");

for (const proposition of adaptation.propositions) {
  assert(proposition.canonical_sentence_ids.every((id) => canonicalSentences.has(id)), `${proposition.id}: unknown canonical sentence ID`);
  assert(proposition.canonical_sentence_ids.every((id) => adaptation.canonical_sentence_ids.includes(id)), `${proposition.id}: sentence is outside the adapted scene`);
  assert(proposition.source_claim_ids.every((id) => canonicalClaims.has(id)), `${proposition.id}: unknown source claim ID`);
}

for (const [format, settings] of Object.entries(adaptation.formats)) {
  const coveredPropositions = [];
  const coveredSentences = [];
  assert(typeof settings.scene_title === "string" && settings.scene_title.length > 0, `${format}: scene title is required`);
  assert(Array.isArray(settings.blocks) && settings.blocks.length > 0, `${format}: at least one copy block is required`);
  for (const block of settings.blocks) {
    assert(typeof block.text === "string" && block.text.trim().length > 0, `${format}.${block.id}: visible text is required`);
    assert(block.canonical_sentence_ids.every((id) => adaptation.canonical_sentence_ids.includes(id)), `${format}.${block.id}: sentence mapping drifted`);
    assert(block.proposition_ids.every((id) => propositionIds.includes(id)), `${format}.${block.id}: proposition mapping drifted`);
    coveredSentences.push(...block.canonical_sentence_ids);
    coveredPropositions.push(...block.proposition_ids);
  }
  assert(JSON.stringify([...new Set(coveredSentences)]) === JSON.stringify(adaptation.canonical_sentence_ids), `${format}: canonical sentence coverage is incomplete or reordered`);
  assert(JSON.stringify([...new Set(coveredPropositions)]) === JSON.stringify(propositionIds), `${format}: clinical proposition coverage is incomplete or reordered`);
}

for (const format of ["linear_video", "chaptered_video"]) {
  const channels = adaptation.formats[format].channels;
  assert(channels.visible_caption === "visible_by_default_live_text", `${format}: caption must be visible by default`);
  assert(channels.transcript === "visible_caption_is_the_active_scene_transcript", `${format}: the visible caption must serve as the active scene transcript`);
  assert(channels.narration === "same_text_as_visible_caption", `${format}: narration and visible caption must match`);
}

const formatCopy = expectedFormats.map((format) => adaptation.formats[format].blocks.map((block) => block.text).join(" "));
assert(new Set(formatCopy).size > 1, "The prototype must demonstrate claim-preserving medium-specific copy");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Copy adaptations valid: ${expectedFormats.length} formats, ${propositionIds.length} propositions, ${adaptation.canonical_sentence_ids.length} canonical sentence IDs.`);
