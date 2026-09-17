import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { flattenRecordCharacters, speechEndSeconds, wordTimings } from "../scripts/lib/narration-timing.mjs";

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
