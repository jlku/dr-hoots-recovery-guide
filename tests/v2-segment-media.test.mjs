import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadSegmentBundle } from "../scripts/lib/segments.mjs";
import { buildConcatCommand, probeDurationSeconds, renderSegmentAudio, timelineElements } from "../scripts/lib/segment-audio.mjs";
import { buildMediaIndex, buildMediaPlan, languagesWithNarration, mediaPaths } from "../scripts/build-segment-media.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("the media plan covers every segment for every narrated language", () => {
  assert.deepEqual(languagesWithNarration(bundle.segments), ["en"]);
  const plan = buildMediaPlan(bundle);
  // Four variants of segment 2, one per combination of its medication beats, and one of each other segment.
  assert.equal(plan.length, 8);
  assert.deepEqual(plan.filter((item) => item.segment.number === 2).map((item) => item.variant), ["a0p0", "a0p1", "a1p0", "a1p1"]);
  assert.equal(mediaPaths(bundle.segments.segments[1], "en", "a1p0").audio, "assets/audio/v2/en/next-two-weeks.a1p0.mp3");
  assert.deepEqual(mediaPaths(bundle.segments.segments[0], "en"), {
    timeline: "assets/captions/v2/en/incision-day2.timeline.json",
    vtt: "assets/captions/v2/en/incision-day2.vtt",
    audio: "assets/audio/v2/en/incision-day2.mp3"
  });
  assert.equal(plan[0].timeline.audio_file, "assets/audio/v2/en/incision-day2.mp3");
  assert.match(plan[0].vtt, /^WEBVTT/);
  const index = buildMediaIndex(plan);
  assert.equal(index.entries.length, 8);
  const whoToCall = index.entries.find((entry) => entry.segment_id === "seg/who-to-call");
  assert.equal(whoToCall.captions, "assets/captions/v2/en/who-to-call.vtt");
  assert.equal(whoToCall.variant, "");
});

test("the concat command mirrors the timeline: title silence, trimmed tracks, gaps, tail", () => {
  const { timeline } = buildMediaPlan(bundle)[0];
  const elements = timelineElements(timeline);
  assert.deepEqual(elements.map((element) => element.kind), ["silence", "track", "silence", "track", "silence"]);
  assert.equal(elements[0].seconds, 1.5);
  assert.equal(elements[2].seconds, 0.6);
  assert.equal(elements[4].seconds, 0.9);
  assert.equal(elements[1].seconds, timeline.beats[0].speech_seconds);
  const { args } = buildConcatCommand({ timeline, root, outputPath: "/tmp/out.mp3" });
  const filter = args[args.indexOf("-filter_complex") + 1];
  assert.match(filter, /concat=n=5:v=0:a=1\[out\]/);
  assert.match(filter, new RegExp(`atrim=0:${timeline.beats[0].speech_seconds.toFixed(3)}`));
  assert.ok(args.includes(join(root, "assets/audio/draft/wound-day2.mp3")));
  assert.equal(args.at(-1), "/tmp/out.mp3");
});

test("rendered audio matches the timeline duration", { skip: hasFfmpeg ? false : "ffmpeg is not installed" }, async () => {
  const { timeline } = buildMediaPlan(bundle)[1];
  const directory = await mkdtemp(join(tmpdir(), "segment-audio-"));
  const outputPath = join(directory, "next-two-weeks.mp3");
  await renderSegmentAudio({ timeline, root, outputPath });
  const duration = await probeDurationSeconds(outputPath);
  assert.ok(Math.abs(duration - timeline.duration_seconds) < 0.25, `${duration} vs ${timeline.duration_seconds}`);
});
