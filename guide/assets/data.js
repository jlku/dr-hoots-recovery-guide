// guide/assets/data.js
// Fetches the content, media index, frames, language pack, and reviews the guide pages need.
import { normalizeLanguage } from "./logic.js";

const ROOT = new URL("../../", import.meta.url);
const ARTIFACT = "ci-phase0-v0.1.0";

export function assetUrl(path) {
  return new URL(path, ROOT).href;
}

export async function fetchJson(path) {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

export async function fetchOptionalJson(path) {
  try {
    return await fetchJson(path);
  } catch {
    return null;
  }
}

export function canonicalSentences(canonical) {
  return new Map(canonical.modules.flatMap((module) => module.canonical_sentences.map((sentence) => [sentence.id, sentence.text])));
}

export async function loadGuide(requestedLanguage) {
  const language = normalizeLanguage(requestedLanguage);
  const [segments, canonical, index, frames] = await Promise.all([
    fetchJson(`content/segments/${ARTIFACT}.segments.json`),
    fetchJson(`content/canonical/${ARTIFACT}.json`),
    fetchJson("assets/captions/v2/index.json"),
    fetchJson(`content/frames/${ARTIFACT}.frames.json`)
  ]);
  let pack = language === "en" ? null : await fetchOptionalJson(`content/translations/${language}/${ARTIFACT}.json`);
  let packFallback = false;
  if (!pack) {
    pack = await fetchJson(`content/translations/en/${ARTIFACT}.json`);
    packFallback = language !== "en";
  }
  const sentences = pack.language === "en" ? canonicalSentences(canonical) : new Map(Object.entries(pack.sentences ?? {}));
  const reviews = await fetchOptionalJson("content/reviews/index.json");
  const instructions = await fetchJson(`content/instructions/${ARTIFACT}.instructions.json`);
  const presets = (await fetchOptionalJson("content/provider/presets.json"))?.presets ?? {};
  return { language, segments, canonical, index, frames, pack, packFallback, sentences, reviews, instructions, presets };
}
