// tests/v2-provider.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { applyPresets, buildPatientLink, normalizeDate, parseProviderBlock, parseYesNo } from "../guide/assets/provider.js";

const root = resolve(import.meta.dirname, "..");
const presets = JSON.parse(await readFile(resolve(root, "content/provider/presets.json"), "utf8")).presets;

test("yes and no parse tolerantly, and an unchosen Epic list is never guessed", () => {
  for (const text of ["yes", "Y", "Yes: amoxicillin 500 mg for 7 days", "{Yes}", "yes."]) assert.equal(parseYesNo(text), true, text);
  for (const text of ["no", "N", "No: acetaminophen as needed", "{No}"]) assert.equal(parseYesNo(text), false, text);
  for (const text of ["{Yes/No}", "{Yes: *** name, dose, days / No}", "***", "", "maybe"]) assert.equal(parseYesNo(text), null, text);
});

test("dates accept ISO and US formats and normalize to ISO", () => {
  assert.equal(normalizeDate("2026-10-01"), "2026-10-01");
  assert.equal(normalizeDate("10/1/2026"), "2026-10-01");
  assert.equal(normalizeDate("wound check and ear exam on 10/01/26"), "2026-10-01");
  assert.equal(normalizeDate("***"), null);
  assert.equal(normalizeDate("13/40/2026"), null);
});

test("the block reads only its five driving lines, lists what it could not read, and applies presets", () => {
  const block = [
    ".CIPOSTOP  Cochlear implant post-operative instructions (UCSF OHNS)",
    "Surgery date: 9/15/2026          Side: Right          Surgeon: Dr. Example",
    "Antibiotic: No",
    "Pain medication: {Yes: *** / No: acetaminophen as needed}",
    "Follow-up: wound check and ear exam on 10/1/2026",
    "Video guide: language Spanish    Reviewed by Song on 9/17/2026"
  ].join("\n");
  const parsed = parseProviderBlock(block);
  assert.deepEqual(parsed.fields, { antibiotic: false, follow_up_date: "2026-10-01", language: "es", reviewed: { by: "Song", date: "2026-09-17" } });
  assert.deepEqual(parsed.unread, ["Pain medication: {Yes: *** / No: acetaminophen as needed}"]);
  assert.equal(parsed.other, 2);
  const merged = applyPresets(parsed.fields, presets);
  assert.equal(merged.values.pain_medication, true);
  assert.deepEqual(merged.from_presets, ["pain_medication"]);
  assert.equal(buildPatientLink(merged.values), "guide/index.html#a=0&p=1&f=2026-10-01&l=es&r=2026-09-17");
});

test("the link carries no names, and an empty block is all presets", () => {
  const merged = applyPresets(parseProviderBlock("").fields, presets);
  assert.deepEqual([...merged.from_presets].sort(), ["antibiotic", "follow_up_date", "language", "pain_medication"]);
  assert.equal(buildPatientLink(merged.values), "guide/index.html#a=1&p=1&l=en");
  const named = buildPatientLink({ ...merged.values, reviewed: { by: "Song Lee", date: "2026-09-17" } });
  assert.ok(!named.includes("Song"), "the reviewer's name never enters the link");
});

test("the spec's unfilled draft block reads as all presets, with its unchosen lines listed", () => {
  const draft = [
    "Antibiotic: {Yes: *** name, dose, days / No}",
    "Pain medication: {Yes: *** / No: acetaminophen as needed}",
    "Follow-up: wound check and ear exam on ***",
    "Video guide: language {English/Spanish/Mandarin}    Reviewed by *** on ***"
  ].join("\n");
  const parsed = parseProviderBlock(draft);
  assert.deepEqual(parsed.fields, {});
  assert.equal(parsed.unread.length, 4);
  assert.equal(buildPatientLink(applyPresets(parsed.fields, presets).values), "guide/index.html#a=1&p=1&l=en");
});
