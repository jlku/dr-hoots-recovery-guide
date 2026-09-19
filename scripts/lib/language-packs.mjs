import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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
  "ui.review_status",
  "ui.call_help",
  "ui.nursing_line",
  "ui.emergency",
  "ui.follow_along",
  "ui.chapter",
  "ui.of",
  "ui.previous_chapter",
  "ui.next_chapter",
  "ui.print_card",
  "ui.captions"
]);

export const TRANSLATION_STATUSES = Object.freeze(["machine_draft", "ai_reviewed", "human_reviewed"]);

// Words that keep the fever threshold's direction and unit, per language. English is the source, so
// it has none. A new language cannot pass validation until its alternatives are listed here.
const OVER = { es: ["más de", "por encima de", "superior a", "mayor de", "mayor que"], "zh-Hans": ["超过", "高于"] };
const FAHRENHEIT = { es: ["Fahrenheit", "°F"], "zh-Hans": ["华氏", "°F"] };
export const PROTECTED_PHRASES = Object.freeze({
  es: { "call.02": [OVER.es, FAHRENHEIT.es], "ov.fever": [OVER.es, ["°F", "Fahrenheit"]] },
  "zh-Hans": { "call.02": [OVER["zh-Hans"], FAHRENHEIT["zh-Hans"]], "ov.fever": [OVER["zh-Hans"], ["°F", "华氏"]] }
});

export function requiredLabelKeys(segments) {
  return [...UI_LABEL_KEYS, ...segments.segments.flatMap((segment) => [segment.title_key, segment.chip_key])];
}

export function digitTokens(text) {
  return (text.match(/\d+(?:[.,]\d+)?(?:-\d+)*/g) ?? []).map((token) => token.replace(",", "."));
}

export function canonicalSentenceText(canonical) {
  return new Map(canonical.modules.flatMap((module) => module.canonical_sentences.map((sentence) => [sentence.id, sentence.text])));
}

export function validateLanguagePack({ pack, canonical, segments, source = null }) {
  const errors = [];
  if (typeof pack?.language !== "string" || !pack.language) errors.push("language is required");
  if (pack?.artifact_id !== canonical.artifact.id || pack?.artifact_version !== canonical.artifact.version) {
    errors.push("pack must reference the canonical artifact id and version");
  }
  const labels = pack?.labels ?? {};
  const sourceLabels = source?.labels ?? {};
  const required = [...new Set([...requiredLabelKeys(segments), ...Object.keys(sourceLabels)])];
  for (const key of required) {
    if (typeof labels[key] !== "string" || !labels[key].trim()) errors.push(`missing label ${key}`);
  }
  if (pack?.language === "en") {
    if (pack.sentences_source !== "canonical") errors.push("the English pack must declare sentences_source canonical");
    if (pack.sentences) errors.push("the English pack must not copy canonical sentences");
    return { valid: errors.length === 0, errors };
  }
  if (source) {
    for (const key of Object.keys(labels)) if (!(key in sourceLabels)) errors.push(`unknown label ${key}`);
    for (const [key, english] of Object.entries(sourceLabels)) {
      if (typeof labels[key] !== "string") continue;
      const actual = digitTokens(labels[key]);
      for (const token of digitTokens(english)) if (!actual.includes(token)) errors.push(`label ${key} lost protected value ${token}`);
    }
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
  const phrases = PROTECTED_PHRASES[pack?.language];
  if (!phrases) errors.push(`no protected phrases are defined for ${pack?.language}; add them to PROTECTED_PHRASES first`);
  for (const [id, groups] of Object.entries(phrases ?? {})) {
    const isSentence = canonicalText.has(id);
    const text = (isSentence ? sentences[id] : labels[id]) ?? "";
    for (const alternatives of groups) {
      if (!alternatives.some((phrase) => text.includes(phrase))) errors.push(`${isSentence ? "sentence" : "label"} ${id} must keep one of: ${alternatives.join(", ")}`);
    }
  }
  if (!TRANSLATION_STATUSES.includes(pack?.status)) errors.push(`status must be one of ${TRANSLATION_STATUSES.join(", ")}`);
  if (!pack?.review?.label) errors.push("review.label is required so the UI can show who reviewed the translation");
  return { valid: errors.length === 0, errors };
}

export function resolveSentences({ pack, canonical }) {
  if (pack.language === "en") return canonicalSentenceText(canonical);
  return new Map(Object.entries(pack.sentences ?? {}));
}

// Every pack under content/translations, one directory per language.
export async function loadLanguagePacks(root, artifactFile = "ci-phase0-v0.1.0.json") {
  const base = join(root, "content/translations");
  const entries = await readdir(base, { withFileTypes: true });
  const languages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const packs = [];
  for (const language of languages) {
    const path = `content/translations/${language}/${artifactFile}`;
    packs.push({ language, path, pack: JSON.parse(await readFile(join(root, path), "utf8")) });
  }
  return packs;
}
