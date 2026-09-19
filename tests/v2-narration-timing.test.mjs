import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { flattenRecordCharacters, isSpacelessLanguage, speechEndSeconds, tokenize, wordTimings } from "../scripts/lib/narration-timing.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "assets/audio/draft/manifest.json"), "utf8"));
const record = manifest.records.find((item) => item.id === "wound-day2");

test("flattens a real draft record into one timed character per text position", () => {
  const characters = flattenRecordCharacters(record);
  assert.equal(characters.length, record.text.length);
  assert.equal(characters[0].character, "T");
  assert.ok(characters.every((entry, index) => index === 0 || entry.start >= characters[index - 1].start));
});

test("speech end is the last character end and words carry their own times", () => {
  const end = speechEndSeconds(record);
  const words = wordTimings(record);
  assert.equal(words[0].text, "Two");
  assert.equal(words.at(-1).end, end);
  assert.ok(words.every((word) => word.end >= word.start));
  assert.equal(words.length, record.text.split(/\s+/).length);
});

test("rejects drifted text and malformed timestamps", () => {
  const drifted = structuredClone(record);
  drifted.text += " Soon.";
  assert.throws(() => flattenRecordCharacters(drifted), /do not match/);
  const malformed = structuredClone(record);
  malformed.timestamps[0].character_end_times_seconds[0] = -1;
  assert.throws(() => flattenRecordCharacters(malformed), /malformed/);
});

const timed = (text) => ({ id: "t", text, timestamps: [{ characters: [...text], character_start_times_seconds: [...text].map((_, i) => i * 0.1), character_end_times_seconds: [...text].map((_, i) => i * 0.1 + 0.09) }] });

test("spaced languages split on whitespace and remember the space after each word", () => {
  assert.equal(isSpacelessLanguage("es"), false);
  assert.deepEqual(tokenize("Hola, ¿cómo está?", "es").map(({ text, space }) => [text, space]), [["Hola,", true], ["¿cómo", true], ["está?", false]]);
});

test("Chinese splits into words, keeps punctuation on the word before it, and has no spaces", () => {
  assert.equal(isSpacelessLanguage("zh-Hans"), true);
  const tokens = tokenize("两天后，取下头部绷带。", "zh-Hans");
  assert.equal(tokens.map((token) => token.text).join(""), "两天后，取下头部绷带。");
  assert.ok(tokens.every((token) => token.space === false));
  assert.ok(tokens.some((token) => token.text.endsWith("，")), "the comma stays on the word before it");
  assert.ok(!tokens.some((token) => /^[，。]/.test(token.text)), "no token starts with punctuation");
  const words = wordTimings(timed("两天后，取下头部绷带。"), "zh-Hans");
  assert.equal(words[0].start, 0);
  assert.equal(words.at(-1).end, 1.09);
});
