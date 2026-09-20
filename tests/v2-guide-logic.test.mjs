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
  conditionsFor,
  formatFollowUp,
  formatTime,
  joinWords,
  normalizeLanguage,
  parseFragment,
  pendingConditionalBeats,
  pickEntry,
  segmentByNumber,
  sentenceSpans,
  statusMessages,
  variantFor
} from "../guide/assets/logic.js";
import { phraseTime } from "../guide/assets/frames.js";

const root = resolve(import.meta.dirname, "..");
const timeline = JSON.parse(await readFile(resolve(root, "assets/captions/v2/en/bandage-off.timeline.json"), "utf8"));
const multiBeat = JSON.parse(await readFile(resolve(root, "assets/captions/v2/en/programming-visits.timeline.json"), "utf8"));
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
  assert.deepEqual(availableLanguages(index), ["en", "es", "zh-Hans"]);
  assert.equal(pickEntry(index, 1, "es").entry.language, "es");
  const exact = pickEntry(index, 1, "en");
  assert.equal(exact.fallback, false);
  assert.equal(exact.entry.segment_id, "seg/bandage-off");
  const englishOnly = { ...index, entries: index.entries.filter((entry) => entry.language === "en") };
  const fallback = pickEntry(englishOnly, 1, "es");
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.entry.language, "en");
  assert.equal(pickEntry(index, 9, "en").entry, null);
  assert.equal(segmentByNumber(segments, 3).id, "seg/next-two-weeks");
  assert.equal(segmentByNumber(segments, 9), null);
  // A medication beat is pending only when the link switches it off: its "no" wording waits on Song.
  assert.deepEqual(pendingConditionalBeats(segmentByNumber(segments, 3), { antibiotic: false, pain_medication: true }).map((beat) => beat.id), ["beat/medication-antibiotic"]);
  assert.equal(pendingConditionalBeats(segmentByNumber(segments, 3), { antibiotic: true, pain_medication: true }).length, 0);
  assert.equal(pendingConditionalBeats(segmentByNumber(segments, 1)).length, 0);
});

test("the clock resolves title card, beats, cues, and active words from a real timeline", () => {
  assert.equal(activeBeat(multiBeat, 0), null);
  assert.equal(activeBeat(multiBeat, 1.5).id, "beat/healing");
  assert.equal(activeBeat(multiBeat, multiBeat.beats[1].start).id, "beat/programming");
  assert.equal(activeBeat(multiBeat, multiBeat.beats[0].end + 0.1).id, "beat/healing");
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
  // Who reviewed the translation moved to the review badges; the status strip keeps only warnings.
  assert.deepEqual(statusMessages({ pack: { language: "es", review: { label: "Revisado por IA (Claude), no por un traductor médico certificado" } }, fallback: false, labels }), []);
  assert.deepEqual(statusMessages({ pack: { language: "en", review: {} }, fallback: true, labels }), ["This language is not available yet. Showing English."]);
});

test("the link's medication flags choose the medication segment's variant, with presets for missing flags", () => {
  const presets = { antibiotic: true, pain_medication: true };
  assert.equal(variantFor({ a: "0", p: "1" }, presets), "a0p1");
  assert.equal(variantFor({}, presets), "a1p1");
  assert.equal(variantFor({}, { antibiotic: false, pain_medication: true }), "a0p1");
  assert.deepEqual(conditionsFor("a0p1"), { antibiotic: false, pain_medication: true });
  const variants = { entries: [{ number: 2, language: "en", variant: "a0p1" }, { number: 2, language: "en", variant: "a1p1" }, { number: 1, language: "en", variant: "" }] };
  assert.equal(pickEntry(variants, 2, "en", "a0p1").entry.variant, "a0p1");
  assert.equal(pickEntry(variants, 2, "en").entry.variant, "a1p1", "without flags, every medication beat plays");
  assert.equal(pickEntry(variants, 1, "en", "a0p1").entry.variant, "", "a segment without variants ignores the flags");
});

test("a medication the link switches off shows the pending note in the status strip, and a follow-up date reads in the patient's language", () => {
  const labels = { "ui.pending_clinician_text": "Medication details are pending your surgeon's wording.", "ui.language_fallback": "Showing English." };
  assert.deepEqual(statusMessages({ pack: { language: "en" }, fallback: false, labels }), [], "a medication left out by the link is not announced to the patient");
  assert.equal(formatFollowUp("2026-10-01", "en"), "October 1, 2026");
  assert.equal(formatFollowUp("2026-10-01", "es"), "1 de octubre de 2026");
  assert.equal(formatFollowUp("2026-10-01", "zh-Hans"), "2026年10月1日");
});

test("a translation no reviewer has passed says so, and a reviewed one says nothing", () => {
  const labels = { "ui.language_fallback": "This language is not available yet. Showing English." };
  const draft = { language: "zh-Hans", status: "machine_draft", review: { label: "机器翻译草稿，尚未审核", date: "2026-09-18" } };
  assert.deepEqual(statusMessages({ pack: draft, fallback: false, labels }), ["机器翻译草稿，尚未审核"]);
  assert.deepEqual(statusMessages({ pack: { ...draft, status: "ai_reviewed" }, fallback: false, labels }), [], "who reviewed it belongs on the provider page");
});
