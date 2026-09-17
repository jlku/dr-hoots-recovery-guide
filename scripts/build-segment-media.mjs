import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderSegmentAudio } from "./lib/segment-audio.mjs";
import { buildSegmentTimeline, toWebVtt } from "./lib/segment-timeline.mjs";
import { loadSegmentBundle, segmentSlug, validateSegments } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MEDIA_INDEX_PATH = "assets/captions/v2/index.json";

export function mediaPaths(segment, language) {
  const slug = segmentSlug(segment.id);
  return {
    timeline: `assets/captions/v2/${language}/${slug}.timeline.json`,
    vtt: `assets/captions/v2/${language}/${slug}.vtt`,
    audio: `assets/audio/v2/${language}/${slug}.mp3`
  };
}

export function languagesWithNarration(segments) {
  const languages = new Set();
  for (const segment of segments.segments) {
    for (const beat of segment.beats) {
      for (const language of Object.keys(beat.narration ?? {})) languages.add(language);
    }
  }
  return [...languages].sort();
}

export function buildMediaPlan(bundle) {
  const plan = [];
  for (const language of languagesWithNarration(bundle.segments)) {
    for (const segment of bundle.segments.segments) {
      const paths = mediaPaths(segment, language);
      const timeline = buildSegmentTimeline({ segments: bundle.segments, segment, records: bundle.records, language, audioFile: paths.audio });
      plan.push({ language, segment, paths, timeline, vtt: toWebVtt(timeline.cues) });
    }
  }
  return plan;
}

export function buildMediaIndex(plan) {
  return {
    schema_version: "1.0",
    generated_by: "scripts/build-segment-media.mjs",
    patient_use: false,
    entries: plan.map((item) => ({
      segment_id: item.segment.id,
      number: item.segment.number,
      language: item.language,
      timeline: item.paths.timeline,
      captions: item.paths.vtt,
      audio: item.paths.audio,
      duration_seconds: item.timeline.duration_seconds,
      narration_seconds: item.timeline.narration_seconds
    }))
  };
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function buildSegmentMedia({ root = repositoryRoot, audio = true } = {}) {
  const bundle = await loadSegmentBundle(root);
  const validation = validateSegments(bundle);
  if (!validation.valid) throw new Error(`segments are invalid:\n${validation.errors.join("\n")}`);
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  const plan = buildMediaPlan(bundle);
  const written = [];
  for (const item of plan) {
    for (const [key, content] of [["timeline", serializeJson(item.timeline)], ["vtt", item.vtt]]) {
      const target = join(root, item.paths[key]);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      written.push(item.paths[key]);
    }
    if (audio && hasFfmpeg) {
      const target = join(root, item.paths.audio);
      await mkdir(dirname(target), { recursive: true });
      await renderSegmentAudio({ timeline: item.timeline, root, outputPath: target });
      written.push(item.paths.audio);
    }
  }
  await writeFile(join(root, MEDIA_INDEX_PATH), serializeJson(buildMediaIndex(plan)));
  written.push(MEDIA_INDEX_PATH);
  return { written, audioSkipped: audio && !hasFfmpeg };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSegmentMedia({ audio: !process.argv.includes("--no-audio") });
  for (const path of result.written) console.log(path);
  if (result.audioSkipped) console.warn("ffmpeg is not installed; segment audio was not rendered.");
}
