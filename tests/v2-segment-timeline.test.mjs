import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { loadSegmentBundle } from "../scripts/lib/segments.mjs";
import { buildSegmentTimeline, groupCues, joinWords, toWebVtt, vttTime } from "../scripts/lib/segment-timeline.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const segmentOne = bundle.segments.segments[0];
const segmentTwo = bundle.segments.segments.find((item) => item.id === "seg/next-two-weeks");
const multiBeat = bundle.segments.segments.find((item) => item.id === "seg/programming-visits");

test("a segment starts after the title card and spaces beats by the gap", () => {
  const timeline = buildSegmentTimeline({ segments: bundle.segments, segment: multiBeat, records: bundle.records });
  assert.equal(timeline.title_card.end, 1.5);
  assert.equal(timeline.beats.length, 3);
  assert.equal(timeline.beats[0].start, 1.5);
  assert.equal(timeline.beats[0].end, Number((1.5 + timeline.beats[0].speech_seconds).toFixed(3)));
  assert.equal(timeline.beats[1].start, Number((timeline.beats[0].end + 0.6).toFixed(3)));
  assert.equal(timeline.duration_seconds, Number((timeline.beats[2].end + 0.9).toFixed(3)));
  assert.equal(timeline.words[0].text, "After");
  assert.equal(timeline.words[0].start, 1.5);
  assert.ok(timeline.words.every((word, index) => index === 0 || word.start >= timeline.words[index - 1].start));
  assert.ok(timeline.narration_seconds <= 35);
  assert.equal(typeof timeline.source_records[timeline.beats[0].record_id], "string");
});

test("segment one opens on the first instruction", () => {
  const timeline = buildSegmentTimeline({ segments: bundle.segments, segment: segmentOne, records: bundle.records });
  assert.deepEqual(timeline.beats.map((beat) => beat.id), ["beat/dressing-off"]);
  assert.equal(timeline.words[0].text, "Two");
  assert.equal(timeline.duration_seconds, Number((timeline.beats[0].end + 0.9).toFixed(3)));
});

test("every word lands in exactly one cue and cues never overlap", () => {
  const timeline = buildSegmentTimeline({ segments: bundle.segments, segment: segmentOne, records: bundle.records });
  for (const beat of timeline.beats) {
    const words = timeline.words.filter((word) => word.beat === beat.id).map((word) => word.text).join(" ");
    const cueText = timeline.cues.filter((cue) => cue.beat === beat.id).map((cue) => cue.text).join(" ");
    assert.equal(cueText, words);
    assert.equal(cueText, beat.text.split(/\s+/).join(" "));
  }
  for (let index = 1; index < timeline.cues.length; index += 1) {
    assert.ok(timeline.cues[index].start >= timeline.cues[index - 1].end, timeline.cues[index].id);
  }
  assert.ok(timeline.cues.every((cue) => cue.text.split(" ").length <= 8));
  assert.equal(timeline.cues[0].id, "cue-01");
});

test("conditional beats without narration are omitted from the timeline", () => {
  const timeline = buildSegmentTimeline({ segments: bundle.segments, segment: segmentTwo, records: bundle.records, audioFile: "assets/audio/v2/en/next-two-weeks.mp3" });
  assert.deepEqual(timeline.beats.map((beat) => beat.id), ["beat/milestones"]);
  assert.equal(timeline.audio_file, "assets/audio/v2/en/next-two-weeks.mp3");
});

test("cue grouping breaks on sentence punctuation and the word limit", () => {
  const words = "One two three. Four five six seven eight nine ten eleven".split(" ").map((text, index) => ({ text, start: index, end: index + 0.5, beat: "b" }));
  const cues = groupCues(words, "b", 8, 0);
  assert.deepEqual(cues.map((cue) => cue.text), ["One two three.", "Four five six seven eight nine ten eleven"]);
  assert.equal(cues[1].id, "cue-02");
});

test("WebVTT output is well formed", () => {
  assert.equal(vttTime(1.5), "00:00:01.500");
  assert.equal(vttTime(3661.0421), "01:01:01.042");
  const timeline = buildSegmentTimeline({ segments: bundle.segments, segment: segmentOne, records: bundle.records });
  const vtt = toWebVtt(timeline.cues);
  assert.match(vtt, /^WEBVTT\n\n1\n00:00:01\.500 --> 00:00:/);
  assert.ok(vtt.endsWith("\n"));
});

test("cues record which words they hold, and Chinese cues join without spaces and break at Chinese punctuation", () => {
  const words = ["两天后，", "取下", "头部", "绷带。", "接下来", "检查"].map((text, index) => ({ text, start: index, end: index + 0.9, space: false }));
  const cues = groupCues(words, "beat/a", 8, 0, { maxChars: 16, firstWord: 10 });
  assert.deepEqual(cues.map((cue) => cue.text), ["两天后，", "取下头部绷带。", "接下来检查"]);
  assert.deepEqual(cues.map((cue) => [cue.first_word, cue.word_count]), [[10, 1], [11, 3], [14, 2]]);
  assert.equal(joinWords([{ text: "Hola,", space: true }, { text: "mundo.", space: false }]), "Hola, mundo.");
  assert.equal(joinWords([{ text: "old" }, { text: "timeline" }]), "old timeline", "a word without a space flag counts as spaced");
});
