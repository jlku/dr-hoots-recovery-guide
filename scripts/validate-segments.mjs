import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MEDIA_INDEX_PATH, buildMediaIndex, buildMediaPlan, serializeJson } from "./build-segment-media.mjs";
import { canonicalSentenceText, loadLanguagePacks } from "./lib/language-packs.mjs";
import { CUE_CHARACTERS, HANGING as HANGING_WORDS } from "./lib/segment-timeline.mjs";
import { isSpacelessLanguage } from "./lib/narration-timing.mjs";
import { loadSegmentBundle, segmentNarrationSeconds, validateSegments } from "./lib/segments.mjs";
import { validateNarrationText } from "./lib/v2-narration.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function checkCommittedMedia(bundle, root) {
  const errors = [];
  const plan = buildMediaPlan(bundle);
  const expectedFiles = [
    ...plan.flatMap((item) => [[item.paths.timeline, serializeJson(item.timeline)], [item.paths.vtt, item.vtt]]),
    [MEDIA_INDEX_PATH, serializeJson(buildMediaIndex(plan))]
  ];
  for (const [path, expected] of expectedFiles) {
    let actual;
    try {
      actual = await readFile(join(root, path), "utf8");
    } catch {
      errors.push(`${path} is missing; run npm run segments:build`);
      continue;
    }
    if (actual !== expected) errors.push(`${path} is stale; run npm run segments:build`);
  }
  for (const item of plan) {
    try {
      await readFile(join(root, item.paths.audio));
    } catch {
      errors.push(`${item.paths.audio} is missing; run npm run segments:build with ffmpeg installed`);
    }
  }
  return errors;
}

// What a caption may not do, in any language: run past the budget for its script, or end on a word that
// belongs to the phrase after it. A Spanish caption ran to 61 characters against a budget of 52 and a
// Song reviewer read it as a sentence cut in half.
export function captionShapeErrors(plan) {
  const errors = [];
  for (const item of plan) {
    const spaceless = isSpacelessLanguage(item.timeline.language);
    const budget = spaceless ? CUE_CHARACTERS.spaceless : CUE_CHARACTERS.spaced;
    for (const cue of item.timeline.cues) {
      if (cue.text.length > budget) errors.push(`${item.paths.vtt} ${cue.id}: ${cue.text.length} characters against a budget of ${budget}: "${cue.text}"`);
      const last = cue.text.split(/\s+/).at(-1) ?? "";
      if (!spaceless && /\p{L}$/u.test(last) && HANGING_WORDS.test(last)) errors.push(`${item.paths.vtt} ${cue.id} ends on "${last}", which belongs to the caption after it: "${cue.text}"`);
    }
  }
  return errors;
}

async function main() {
  const checkMedia = process.argv.includes("--media");
  const bundle = await loadSegmentBundle(repositoryRoot);
  const result = validateSegments(bundle);
  const errors = [...result.errors];
  // The English "pack" is the canonical text itself, so a canonical edit fails until the recording follows.
  const packs = [...(await loadLanguagePacks(repositoryRoot)).map((entry) => entry.pack).filter((pack) => pack.language !== "en"), { language: "en", sentences: Object.fromEntries(canonicalSentenceText(bundle.canonical)) }];
  errors.push(...validateNarrationText({ segments: bundle.segments, records: bundle.records, packs }));
  errors.push(...captionShapeErrors(buildMediaPlan(bundle)));
  if (result.valid && checkMedia) errors.push(...(await checkCommittedMedia(bundle, repositoryRoot)));
  const languages = [...new Set(bundle.segments.segments.flatMap((segment) => segment.beats).flatMap((beat) => Object.keys(beat.narration ?? {})))].sort();
  for (const segment of bundle.segments.segments) {
    const seconds = languages.map((language) => {
      try {
        return `${language} ${segmentNarrationSeconds(segment, bundle.records, language).toFixed(1)}s`;
      } catch {
        return `${language} unbound`;
      }
    });
    console.log(`${String(segment.number).padStart(2, "0")}  ${segment.id.padEnd(26)} ${seconds.join("  ")}`);
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    process.exit(1);
  }
  const sentenceCount = bundle.canonical.modules.reduce((sum, module) => sum + module.canonical_sentences.length, 0);
  console.log(`segments valid: ${bundle.segments.segments.length} segments cover ${sentenceCount} canonical sentences${checkMedia ? "; committed media is current" : ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
