// tests/v2-provider.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { applyPresets, buildPatientLink, lineStatuses, normalizeDate, parseProviderBlock, parseYesNo, setFieldLine } from "../guide/assets/provider.js";

const root = resolve(import.meta.dirname, "..");
const presets = JSON.parse(await readFile(resolve(root, "content/provider/presets.json"), "utf8")).presets;
const draftText = await readFile(resolve(root, "content/provider/dot-phrase-draft.txt"), "utf8");
const lineMap = JSON.parse(await readFile(resolve(root, "content/provider/template-lines.json"), "utf8"));

test("yes and no parse tolerantly, and an unchosen Epic list is never guessed", () => {
  for (const text of ["yes", "Y", "Yes: amoxicillin 500 mg for 7 days", "{Yes}", "yes."]) assert.equal(parseYesNo(text), true, text);
  for (const text of ["no", "N", "No: acetaminophen as needed", "{No}", "none", "None", "not needed", "Not prescribed"]) assert.equal(parseYesNo(text), false, text);
  for (const text of ["{Yes/No}", "{Yes: *** name, dose, days / No}", "***", "", "maybe"]) assert.equal(parseYesNo(text), null, text);
});

test("dates accept ISO and US formats and normalize to ISO", () => {
  assert.equal(normalizeDate("2026-10-01"), "2026-10-01");
  assert.equal(normalizeDate("10/1/2026"), "2026-10-01");
  assert.equal(normalizeDate("wound check and ear exam on 10/01/26"), "2026-10-01");
  assert.equal(normalizeDate("***"), null);
  assert.equal(normalizeDate("13/40/2026"), null);
  assert.equal(normalizeDate("wound check on Oct 15, 2026"), "2026-10-15");
  assert.equal(normalizeDate("October 15 2026"), "2026-10-15");
  assert.equal(normalizeDate("15 Sept 2026"), "2026-09-15");
  assert.equal(normalizeDate("Oct 15"), null, "no year is never guessed");
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
  assert.deepEqual(parsed.other.map((entry) => entry.key), [null, "surgery date"]);
  assert.deepEqual(parsed.needs_choice, [], "an unfilled template line keeps its preset");
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

test("the words a clinician would type for the five driving lines are read", () => {
  const parsed = parseProviderBlock(["abx: yes", "Pain meds: No", "F/u: 10/15/2026", "Lang: Chinese"].join("\n"));
  assert.deepEqual(parsed.fields, { antibiotic: true, pain_medication: false, follow_up_date: "2026-10-15", language: "zh-Hans" });
  assert.deepEqual(parseProviderBlock("Language: Spanish").fields, { language: "es" });
  assert.deepEqual(parseProviderBlock("  ANTIBIOTIC :  NO  ").fields, { antibiotic: false });
  assert.deepEqual(parseProviderBlock("Video guide: language English    Reviewed by Dr. Example 9/19/2026").fields.reviewed, { by: "Dr. Example", date: "2026-09-19" });
});

test("details after a yes or no are kept, so the page can say the guide will not show them", () => {
  const parsed = parseProviderBlock(["Antibiotic: Yes: cephalexin 500 mg four times a day for 7 days", "Pain medication: No: acetaminophen as needed"].join("\n"));
  assert.deepEqual(parsed.fields, { antibiotic: true, pain_medication: false });
  assert.deepEqual(parsed.details, { antibiotic: "cephalexin 500 mg four times a day for 7 days", pain_medication: "acetaminophen as needed" });
});

test("a line the provider wrote but the page cannot read, or two lines that disagree, need a choice instead of a preset", () => {
  const unclear = parseProviderBlock("Antibiotic: pending culture results");
  assert.deepEqual(unclear.needs_choice, ["antibiotic"]);
  assert.deepEqual(unclear.unread, ["Antibiotic: pending culture results"]);
  assert.deepEqual(unclear.unclear, { antibiotic: "Antibiotic: pending culture results" });
  assert.deepEqual(unclear.unfilled, [], "a line that needs a choice is not also listed as unfilled");
  const conflict = parseProviderBlock(["Antibiotic: Yes", "Pain medication: Yes", "Antibiotic: No"].join("\n"));
  assert.equal("antibiotic" in conflict.fields, false);
  assert.deepEqual(conflict.needs_choice, ["antibiotic"]);
  assert.deepEqual(conflict.conflicts, [{ field: "antibiotic", lines: ["Antibiotic: Yes", "Antibiotic: No"] }]);
  assert.deepEqual(parseProviderBlock(["Antibiotic: yes", "Antibiotic: Y"].join("\n")).needs_choice, [], "the same answer twice is not a conflict");
});

test("every other line is listed by itself, with its wrapped continuation", () => {
  const parsed = parseProviderBlock(["Shower: may shower and wash hair 5 days after surgery.", "Incision: {Tape present: keep dry 3 days, no cleaning / No tape: clean edges 2x daily", "  with 50/50 hydrogen peroxide and distilled water, then bacitracin}", "Avoid: aspirin, ibuprofen, other NSAIDs for 10 days"].join("\n"));
  assert.deepEqual(parsed.other.map((entry) => entry.key), ["shower", "incision", "avoid"]);
  assert.match(parsed.other[1].text, /2x daily with 50\/50 hydrogen peroxide/);
});

test("each line the guide does not use says whether the guide covers it and whether the provider changed it", () => {
  const template = parseProviderBlock(draftText).other;
  const block = [
    "Surgery date: 9/15/2026          Side: Right          Surgeon: Dr. Example",
    "Dressing: remove the head (mastoid) dressing 2 days after surgery.",
    "Shower: may shower and wash hair 5 days after surgery.            (UCSF CI Center)",
    "Avoid: aspirin, ibuprofen, other NSAIDs for *** days",
    "Activity: no lifting over 10 lb for 2 weeks",
    "Driving: no driving until cleared"
  ].join("\n");
  const statuses = lineStatuses(parseProviderBlock(block).other, { template, covered: lineMap.covered, noteOnly: lineMap.note_only });
  assert.deepEqual(statuses.map((entry) => [entry.key, entry.status]), [["surgery date", "note"], ["dressing", "same"], ["shower", "changed"], ["avoid", "not_covered"], ["activity", "not_covered"], ["driving", "not_covered"]]);
  assert.deepEqual(statuses[2].sentences, ["wc.08"]);
  assert.equal(statuses[3].placeholder, true, "an unfilled *** in a line the guide does not use is flagged");
  assert.equal(statuses[4].placeholder, false);
  const untouched = lineStatuses(template, { template, covered: lineMap.covered, noteOnly: lineMap.note_only });
  assert.ok(untouched.filter((entry) => lineMap.covered[entry.key]).every((entry) => entry.status === "same"), "the practice's own draft matches itself");
});

test("a choice in the table writes the matching line back into the block", () => {
  const block = ["Antibiotic: {Yes: *** name, dose, days / No}", "Pain medication: Yes", "Antibiotic: Yes", "Video guide: language English    Reviewed by Dr. Example on 2026-09-19"].join("\n");
  const chosen = setFieldLine(block, "antibiotic", false);
  assert.deepEqual(chosen.split("\n"), ["Antibiotic: No", "Pain medication: Yes", "Video guide: language English    Reviewed by Dr. Example on 2026-09-19"], "one line replaces every antibiotic line");
  assert.deepEqual(parseProviderBlock(chosen).fields.antibiotic, false);
  const spanish = setFieldLine(chosen, "language", "es");
  assert.match(spanish, /^Video guide: language Spanish {4}Reviewed by Dr\. Example on 2026-09-19$/m, "the review line stays on its line");
  const dated = setFieldLine(spanish, "follow_up_date", "2026-10-15");
  assert.match(dated, /^Follow-up: wound check and ear exam on 10\/15\/2026$/m);
  assert.equal(parseProviderBlock(dated).fields.follow_up_date, "2026-10-15");
  assert.doesNotMatch(setFieldLine(dated, "follow_up_date", null), /Follow-up:/, "clearing the date removes its line");
  const reviewed = setFieldLine("Antibiotic: No", "reviewed", { by: "Dr. Lee", date: "2026-09-20" });
  assert.deepEqual(parseProviderBlock(reviewed).fields.reviewed, { by: "Dr. Lee", date: "2026-09-20" });
});
