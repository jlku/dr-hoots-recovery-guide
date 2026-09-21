// tests/v2-provider.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { applyPresets, buildPatientLink, coveredSentences, lineStatuses, missingFromBlock, normalizeDate, parseProviderBlock, parseYesNo, setFieldLine, writeFieldLine } from "../guide/assets/provider.js";

const root = resolve(import.meta.dirname, "..");
const presets = JSON.parse(await readFile(resolve(root, "content/provider/presets.json"), "utf8")).presets;
const draftText = await readFile(resolve(root, "content/provider/dot-phrase-draft.txt"), "utf8");
const lineMap = JSON.parse(await readFile(resolve(root, "content/provider/template-lines.json"), "utf8"));
const covered = coveredSentences(lineMap);

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
  assert.deepEqual(parsed.needs_choice, ["pain_medication"], "an unfilled template line is still a choice the provider has not made");
  const merged = applyPresets(parsed.fields, presets, { approved: true });
  assert.equal(merged.values.pain_medication, true);
  assert.deepEqual(merged.from_presets, ["pain_medication"]);
  assert.equal(buildPatientLink(merged.values), "guide/index.html#a=0&p=1&f=2026-10-01&l=es", "the reviewer stays in the note: the guide shows no reviewer line, so the link carries no review date");
});

test("the link carries no names, and an empty block is all presets once a clinic approves them", () => {
  const merged = applyPresets(parseProviderBlock("").fields, presets, { approved: true });
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
  assert.deepEqual(parsed.needs_choice, ["antibiotic", "pain_medication", "follow_up_date", "language"], "the draft's own lines are choices, not presets");
  assert.equal(buildPatientLink(applyPresets(parsed.fields, presets, { approved: true }).values), "guide/index.html#a=1&p=1&l=en", "an approved preset still answers a block that leaves the line out");
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
  const statuses = lineStatuses(parseProviderBlock(block).other, { template, covered, noteOnly: lineMap.note_only });
  assert.deepEqual(statuses.map((entry) => [entry.key, entry.status]), [["surgery date", "note"], ["dressing", "same"], ["shower", "changed"], ["avoid", "not_covered"], ["activity", "not_covered"], ["driving", "not_covered"]]);
  assert.deepEqual(statuses[2].sentences, ["wc.08"]);
  assert.equal(statuses[3].placeholder, true, "an unfilled *** in a line the guide does not use is flagged");
  assert.equal(statuses[4].placeholder, false);
  const untouched = lineStatuses(template, { template, covered, noteOnly: lineMap.note_only });
  assert.ok(untouched.filter((entry) => covered[entry.key]).every((entry) => entry.status === "same"), "the practice's own draft matches itself");
});

test("a choice in the table writes the matching line back into the block", () => {
  const block = ["Antibiotic: {Yes: *** name, dose, days / No}", "Pain medication: Yes", "Antibiotic: Yes", "Video guide: language English    Reviewed by Dr. Example on 2026-09-19"].join("\n");
  const chosen = setFieldLine(block, "antibiotic", false);
  // Every antibiotic line is rewritten so the two agree. The duplicate is not deleted: the page rewrites
  // the value it owns and never removes a line the clinician typed, because this text goes to the chart.
  assert.deepEqual(chosen.split("\n"), ["Antibiotic: No", "Pain medication: Yes", "Antibiotic: No", "Video guide: language English    Reviewed by Dr. Example on 2026-09-19"]);
  assert.deepEqual(parseProviderBlock(chosen).fields.antibiotic, false);
  const spanish = setFieldLine(chosen, "language", "es");
  assert.match(spanish, /^Video guide: language Spanish {4}Reviewed by Dr\. Example on 2026-09-19$/m, "the review line stays on its line");
  const dated = setFieldLine(spanish, "follow_up_date", "2026-10-15");
  assert.match(dated, /^Follow-up: wound check and ear exam on 10\/15\/2026$/m);
  assert.equal(parseProviderBlock(dated).fields.follow_up_date, "2026-10-15");
  // Clearing the date puts the template's own blank back rather than deleting the clinician's sentence
  // about the visit, which used to disappear whole.
  assert.match(setFieldLine(dated, "follow_up_date", null), /^Follow-up: wound check and ear exam on \*\*\*$/m);
  const reviewed = setFieldLine("Antibiotic: No", "reviewed", { by: "Dr. Lee", date: "2026-09-20" });
  assert.deepEqual(parseProviderBlock(reviewed).fields.reviewed, { by: "Dr. Lee", date: "2026-09-20" });
});

test("an unlabeled line counts as an instruction, and the header stays a note", () => {
  const template = parseProviderBlock(draftText).other;
  const block = [".CIPOSTOP  Cochlear implant post-operative instructions (UCSF OHNS)", "No NSAIDs (aspirin, ibuprofen, naproxen) x 10 days post-op -- bleeding risk."].join("\n");
  const statuses = lineStatuses(parseProviderBlock(block).other, { template, covered, noteOnly: lineMap.note_only });
  assert.deepEqual(statuses.map((entry) => entry.status), ["note", "not_covered"], "only the practice's own unlabeled lines are notes");
});

test("the guide's own steps that the block never mentions are listed, so deleting a line hides nothing", () => {
  const block = ["Antibiotic: No", "Shower: may shower and wash hair 5 days after surgery."].join("\n");
  const missing = missingFromBlock(parseProviderBlock(block).other, { covered });
  assert.deepEqual(missing.map((entry) => entry.key), ["dressing", "incision", "activation", "when to call", "contact"], "shower is mentioned, the rest are not");
  assert.deepEqual(missing[0].sentences, ["wc.01", "wc.02"]);
  assert.deepEqual(missingFromBlock(parseProviderBlock(draftText).other, { covered }), [], "the practice's own draft mentions every covered step");
});

test("editing a value keeps the note's margin, so the chart entry survives the edit", () => {
  const block = [
    "Follow-up: wound check and ear exam on ***                                     (UCSF CI Center: about 2 weeks;",
    "                                                                                UCSF EARS: 7-10 days; timeline PDF: 2-3 weeks)",
    "Video guide: language English    Reviewed by Song on 09/17/2026"
  ].join("\n");
  const out = setFieldLine(block, "follow_up_date", "2026-10-15").split("\n");
  assert.match(out[0], /^Follow-up: wound check and ear exam on 10\/15\/2026 +\(UCSF CI Center: about 2 weeks;$/);
  assert.equal(out[0].indexOf("("), block.split("\n")[0].indexOf("("), "the margin keeps its column");
  assert.equal(out[1], block.split("\n")[1], "the indented half of the note is untouched, not orphaned");
  assert.equal(out[2], "Video guide: language English    Reviewed by Song on 09/17/2026");
});

test("nothing the clinician wrote disappears: a continuation under a driving line becomes a line of its own", () => {
  // A driving line is a value, not a sentence any list renders, so text appended to it used to vanish
  // from the page: it was in the textarea and in no review list. This is the NSAID warning both
  // walkthrough users asked for, and it disappeared without a word.
  const parsed = parseProviderBlock(["Antibiotic: Yes", "  IMPORTANT: do not take ibuprofen or any NSAID for 10 days", "Shower: you may shower 3 days after surgery"].join("\n"));
  assert.deepEqual(parsed.other.map((entry) => entry.text), [
    "IMPORTANT: do not take ibuprofen or any NSAID for 10 days",
    "Shower: you may shower 3 days after surgery"
  ], "the warning is a line of its own, so the page can say the guide will not carry it");
  assert.equal(parsed.fields.antibiotic, true, "the driving line still reads");

  const wrapped = parseProviderBlock(["Shower: you may shower and wash your hair", "  three days after surgery"].join("\n"));
  assert.deepEqual(wrapped.other.map((entry) => entry.text), ["Shower: you may shower and wash your hair three days after surgery"], "an ordinary wrapped line still joins the line above it");

  const everyLine = (block) => {
    const result = parseProviderBlock(block);
    return [...result.other.map((entry) => entry.text), ...result.unread].join(" ");
  };
  for (const tail of ["do not lift more than 10 pounds for 2 weeks", "cephalexin 500 mg three times daily", "call if you have a fever over 101.5"]) {
    assert.match(everyLine(["Pain medication: Yes", `  ${tail}`].join("\n")), new RegExp(tail.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `"${tail}" must appear somewhere the clinician can see it`);
  }
});

test("an unapproved preset is an offer, not an answer: silence never becomes speech", () => {
  // content/provider/presets.json is status placeholder_for_song, patient_use false. Until a clinic
  // approves it, a line the block leaves out has no author, and a value with no author may not reach a
  // patient. A prose note whose own words were "We did not send you home on an antibiotic" used to
  // produce a=1 from that file.
  const empty = applyPresets(parseProviderBlock("").fields, presets, { approved: false });
  assert.deepEqual(empty.unauthored, ["antibiotic", "pain_medication", "language"], "each substantive default needs an author");
  assert.deepEqual(empty.from_presets, ["follow_up_date"], "a preset of null asserts nothing, so it needs none");
  assert.equal("antibiotic" in empty.values, false, "and no value is invented for the ones that do");
  assert.throws(() => buildPatientLink(empty.values), /antibiotic has no value/, "a link cannot be built past the gate");

  const answered = applyPresets(parseProviderBlock("Antibiotic: No\nPain medication: Yes\nVideo guide: language Spanish").fields, presets, { approved: false });
  assert.deepEqual(answered.unauthored, [], "a block that answers them needs nothing");
  assert.equal(buildPatientLink(answered.values), "guide/index.html#a=0&p=1&l=es");
});

test("the write-back rewrites the value and never the clinician's words", () => {
  // A nurse clicked No and the page turned "Antibiotic: Yes cephalexin 500 mg, 7 days" into
  // "Antibiotic: No", destroying the drug, the dose and the duration — in text that goes back into the
  // chart, with no undo. The page now owns the answer token and nothing else.
  const kept = writeFieldLine("Antibiotic: Yes cephalexin 500 mg, 7 days", "antibiotic", false);
  assert.equal(kept.text, "Antibiotic: No cephalexin 500 mg, 7 days");
  assert.equal(kept.outcome, "rewrote");
  assert.equal(kept.tail, "cephalexin 500 mg, 7 days", "and it says the tail now contradicts the answer");

  const prose = writeFieldLine("Antibiotic: pending culture results", "antibiotic", false);
  assert.equal(prose.text, "Antibiotic: pending culture results", "words it cannot read are left exactly as written");
  assert.equal(prose.outcome, "kept");
  assert.equal(prose.kept, "pending culture results");

  const added = writeFieldLine("Shower: 3 days\nReviewed by Dr. Lee on 9/9/2026", "antibiotic", false);
  assert.deepEqual(added.text.split("\n"), ["Shower: 3 days", "Antibiotic: No", "Reviewed by Dr. Lee on 9/9/2026"], "a new line goes above the signature, never below it");
  assert.equal(added.outcome, "added");

  assert.equal(writeFieldLine("Video guide: language Spanish", "language", "zh-Hans").text, "Video guide: language Mandarin");
  assert.equal(writeFieldLine("Follow up: come back in two to three weeks", "follow_up_date", "2026-10-15").outcome, "kept", "a sentence with no date token is theirs to edit");
});
