import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { buildGuideClock, globalToLocal, localToGlobal, sentenceSpans, activeSentence } from "../guide/assets/logic.js";

const root = resolve(import.meta.dirname, "..");
const timeline = JSON.parse(await readFile(resolve(root, "assets/captions/v2/en/incision-day2.timeline.json"), "utf8"));
const numbers = JSON.parse(await readFile(resolve(root, "assets/captions/v2/en/who-to-call.timeline.json"), "utf8"));
const index = JSON.parse(await readFile(resolve(root, "assets/captions/v2/index.json"), "utf8"));

test("sentences are cut at terminal punctuation and never cross a beat", () => {
  const sentences = sentenceSpans(timeline);
  assert.equal(sentences.length, 4);
  assert.equal(sentences[0].text, "Two days after surgery, remove the head bandage.");
  assert.equal(sentences[1].text, "Then check: is there tape over the incision behind your ear?");
  assert.equal(sentences[1].beat, "beat/dressing-off");
  assert.equal(sentences[2].beat, "beat/two-paths");
  assert.ok(sentences[3].text.endsWith("bacitracin."));
  assert.equal(sentences[0].start, timeline.words[0].start);
  assert.equal(sentences.flatMap((sentence) => sentence.words).length, timeline.words.length);
  assert.ok(sentences.every((sentence, index) => index === 0 || sentence.start >= sentences[index - 1].end - 0.001));
  assert.equal(sentences[0].id, "sent-01");
});

test("a decimal inside a number does not end a sentence", () => {
  const sentences = sentenceSpans(numbers);
  assert.equal(sentences.length, 3);
  assert.ok(sentences[0].text.endsWith("415-353-2148."));
  assert.ok(sentences[1].text.endsWith("call again."));
  assert.ok(sentences[2].text.endsWith("on call."));
});

test("the active sentence is the last one that has started", () => {
  const sentences = sentenceSpans(timeline);
  assert.equal(activeSentence(sentences, 0), null);
  assert.equal(activeSentence(sentences, sentences[0].start).id, "sent-01");
  assert.equal(activeSentence(sentences, sentences[1].start + 0.2).id, "sent-02");
  assert.equal(activeSentence(sentences, 999).id, "sent-04");
});

test("the guide clock maps one continuous timeline onto per-segment audio", () => {
  const entries = index.entries.filter((entry) => entry.language === "en");
  const clock = buildGuideClock(entries);
  assert.equal(clock.segments.length, 5);
  assert.equal(clock.segments[0].offset, 0);
  assert.equal(clock.segments[1].offset, clock.segments[0].duration);
  assert.equal(clock.total, clock.segments.reduce((sum, segment) => sum + segment.duration, 0));
  assert.deepEqual(globalToLocal(clock, 0), { number: 1, local: 0 });
  assert.deepEqual(globalToLocal(clock, clock.segments[1].offset + 1), { number: 2, local: 1 });
  assert.equal(globalToLocal(clock, clock.total + 50).number, 5);
  assert.equal(localToGlobal(clock, 3, 2), clock.segments[2].offset + 2);
  assert.equal(globalToLocal(clock, -5).local, 0);
});
