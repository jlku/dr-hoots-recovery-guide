import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MEDIA_INDEX_PATH, buildMediaIndex, buildMediaPlan, serializeJson } from "./build-segment-media.mjs";
import { loadLanguagePacks } from "./lib/language-packs.mjs";
import { loadSegmentBundle, segmentNarrationSeconds, validateSegments } from "./lib/segments.mjs";
import { validateTranslatedNarration } from "./lib/v2-narration.mjs";

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

async function main() {
  const checkMedia = process.argv.includes("--media");
  const bundle = await loadSegmentBundle(repositoryRoot);
  const result = validateSegments(bundle);
  const errors = [...result.errors];
  const packs = (await loadLanguagePacks(repositoryRoot)).map((entry) => entry.pack);
  errors.push(...validateTranslatedNarration({ segments: bundle.segments, records: bundle.records, packs }));
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
