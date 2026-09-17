import { canonicalSentenceOrder } from "./segments.mjs";

export const UI_LABEL_KEYS = Object.freeze([
  "guide.title",
  "guide.subtitle",
  "ui.play",
  "ui.pause",
  "ui.next",
  "ui.previous",
  "ui.subtitles",
  "ui.language",
  "ui.speed",
  "ui.contents",
  "ui.card",
  "ui.notice",
  "ui.pending_clinician_text",
  "ui.follow_up_default",
  "ui.seek",
  "ui.coming",
  "ui.language_fallback",
  "ui.not_reviewed",
  "ui.replay",
  "ui.transcript",
  "ui.review_status"
]);

export const TRANSLATION_STATUSES = Object.freeze(["machine_draft", "ai_reviewed", "human_reviewed"]);

export function requiredLabelKeys(segments) {
  return [...UI_LABEL_KEYS, ...segments.segments.flatMap((segment) => [segment.title_key, segment.chip_key])];
}

export function digitTokens(text) {
  return (text.match(/\d+(?:[.,]\d+)?(?:-\d+)*/g) ?? []).map((token) => token.replace(",", "."));
}

export function canonicalSentenceText(canonical) {
  return new Map(canonical.modules.flatMap((module) => module.canonical_sentences.map((sentence) => [sentence.id, sentence.text])));
}

export function validateLanguagePack({ pack, canonical, segments }) {
  const errors = [];
  if (typeof pack?.language !== "string" || !pack.language) errors.push("language is required");
  if (pack?.artifact_id !== canonical.artifact.id || pack?.artifact_version !== canonical.artifact.version) {
    errors.push("pack must reference the canonical artifact id and version");
  }
  const labels = pack?.labels ?? {};
  for (const key of requiredLabelKeys(segments)) {
    if (typeof labels[key] !== "string" || !labels[key].trim()) errors.push(`missing label ${key}`);
  }
  if (pack?.language === "en") {
    if (pack.sentences_source !== "canonical") errors.push("the English pack must declare sentences_source canonical");
    if (pack.sentences) errors.push("the English pack must not copy canonical sentences");
    return { valid: errors.length === 0, errors };
  }
  const canonicalText = canonicalSentenceText(canonical);
  const sentences = pack?.sentences ?? {};
  for (const id of canonicalSentenceOrder(canonical)) {
    const text = sentences[id];
    if (typeof text !== "string" || !text.trim()) {
      errors.push(`missing sentence ${id}`);
      continue;
    }
    const actual = digitTokens(text);
    for (const token of digitTokens(canonicalText.get(id))) {
      if (!actual.includes(token)) errors.push(`sentence ${id} lost protected value ${token}`);
    }
  }
  for (const id of Object.keys(sentences)) {
    if (!canonicalText.has(id)) errors.push(`unknown sentence ${id}`);
  }
  if (!TRANSLATION_STATUSES.includes(pack?.status)) errors.push(`status must be one of ${TRANSLATION_STATUSES.join(", ")}`);
  if (!pack?.review?.label) errors.push("review.label is required so the UI can show who reviewed the translation");
  return { valid: errors.length === 0, errors };
}

export function resolveSentences({ pack, canonical }) {
  if (pack.language === "en") return canonicalSentenceText(canonical);
  return new Map(Object.entries(pack.sentences ?? {}));
}
