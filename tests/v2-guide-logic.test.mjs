// tests/v2-guide-logic.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  activeBeat,
  activeCue,
  activeWordIndex,
  assignWordsToCues,
  availableLanguages,
  buildFragment,
  formatTime,
  joinWords,
  normalizeLanguage,
  parseFragment,
  pendingConditionalBeats,
  pickEntry,
  segmentByNumber,
  sentenceSpans,
  statusMessages
} from "../guide/assets/logic.js";
import { phraseTime } from "../guide/assets/frames.js";

const root = resolve(import.meta.dirname, "..");
const timeline = JSON.parse(await readFile(resolve(root, "assets/captions/v2/en/incision-day2.timeline.json"), "utf8"));
const index = JSON.parse(await readFile(resolve(root, "assets/captions/v2/index.json"), "utf8"));
const segments = JSON.parse(await readFile(resolve(root, "content/segments/ci-phase0-v0.1.0.segments.json"), "utf8"));

test("fragment parameters round-trip and unknown languages fall back to English", () => {
  assert.deepEqual(parseFragment("#s=2&l=es&f=2026-10-01"), { s: "2", l: "es", f: "2026-10-01" });
  assert.equal(buildFragment({ s: 2, l: "es", f: "2026-10-01", empty: "" }), "#s=2&l=es&f=2026-10-01");
  assert.equal(buildFragment({}), "");
  assert.equal(normalizeLanguage("zh-Hans"), "zh-Hans");
  assert.equal(normalizeLanguage("fr"), "en");
  assert.equal(normalizeLanguage(undefined), "en");
});

test("media entries pick the requested language or fall back to English with a flag", () => {
  assert.deepEqual(availableLanguages(index), ["en"]);
  const exact = pickEntry(index, 1, "en");
  assert.equal(exact.fallback, false);
  assert.equal(exact.entry.segment_id, "seg/incision-day2");
  const fallback = pickEntry(index, 1, "es");
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.entry.language, "en");
  assert.equal(pickEntry(index, 9, "en").entry, null);
  assert.equal(segmentByNumber(segments, 2).id, "seg/next-two-weeks");
  assert.equal(segmentByNumber(segments, 9), null);
  assert.equal(pendingConditionalBeats(segmentByNumber(segments, 2)).length, 2);
  assert.equal(pendingConditionalBeats(segmentByNumber(segments, 1)).length, 0);
});

test("the clock resolves title card, beats, cues, and active words from a real timeline", () => {
  assert.equal(activeBeat(timeline, 0), null);
  assert.equal(activeBeat(timeline, 1.5).id, "beat/dressing-off");
  assert.equal(activeBeat(timeline, timeline.beats[1].start).id, "beat/two-paths");
  assert.equal(activeBeat(timeline, timeline.beats[0].end + 0.1).id, "beat/dressing-off");
  assert.equal(activeCue(timeline, 0), null);
  assert.equal(activeCue(timeline, 1.5).id, "cue-01");
  const words = assignWordsToCues(timeline);
  assert.equal([...words.values()].flat().length, timeline.words.length);
  assert.equal(words.get("cue-01")[0].text, "Two");
  assert.equal(activeWordIndex(words.get("cue-01"), 1.5), 0);
  assert.equal(activeWordIndex(words.get("cue-01"), 0), -1);
  assert.equal(activeWordIndex(words.get("cue-01"), timeline.cues[0].end), words.get("cue-01").length - 1);
});

test("time formats as minutes and seconds", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65.4), "1:05");
  assert.equal(formatTime(28.76), "0:29");
});

test("phrases resolve to the start of their first word, ignoring case and punctuation", () => {
  const words = timeline.words;
  assert.equal(phraseTime(words, "remove the head bandage"), words.find((word) => word.text === "remove").start);
  assert.equal(phraseTime(words, "Then check:"), words.find((word) => word.text === "Then").start);
  assert.equal(phraseTime(words, "not in the narration"), null);
  assert.equal(phraseTime(words, ""), null);
});

test("the guide takes each cue's words from its recorded range and ends Chinese sentences at 。", () => {
  const words = [
    { text: "两天后，", start: 1, end: 1.5, beat: "b", space: false },
    { text: "取下绷带。", start: 1.5, end: 2.5, beat: "b", space: false },
    { text: "然后检查。", start: 2.6, end: 3.5, beat: "b", space: false }
  ];
  const timeline = { words, cues: [{ id: "cue-01", text: "两天后，", first_word: 0, word_count: 1 }, { id: "cue-02", text: "取下绷带。然后检查。", first_word: 1, word_count: 2 }] };
  assert.deepEqual(assignWordsToCues(timeline).get("cue-02").map((word) => word.text), ["取下绷带。", "然后检查。"]);
  const sentences = sentenceSpans(timeline);
  assert.deepEqual(sentences.map((sentence) => sentence.text), ["两天后，取下绷带。", "然后检查。"]);
  assert.equal(joinWords([{ text: "a", space: true }, { text: "b" }]), "a b");
});

test("a translated guide always says who reviewed the translation, and says when it fell back to English", () => {
  const labels = { "ui.language_fallback": "This language is not available yet. Showing English." };
  assert.deepEqual(statusMessages({ pack: { language: "en", review: { label: "English source text" } }, fallback: false, labels }), []);
  assert.deepEqual(statusMessages({ pack: { language: "es", review: { label: "Revisado por IA (Claude), no por un traductor médico certificado" } }, fallback: false, labels }), ["Revisado por IA (Claude), no por un traductor médico certificado"]);
  assert.deepEqual(statusMessages({ pack: { language: "en", review: {} }, fallback: true, labels }), ["This language is not available yet. Showing English."]);
});
