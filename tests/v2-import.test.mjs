// tests/v2-import.test.mjs
// The flow nobody had tested: a clinician pastes the after-visit summary their practice already uses,
// which is not this project's draft template. See qa/import/README.md.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { FIELD_ORDER, applyPresets, buildPatientLink, coveredSentences, lineStatuses, missingFromBlock, parseProviderBlock, stripBullet } from "../guide/assets/provider.js";

const root = resolve(import.meta.dirname, "..");
const corpus = [];
for (const name of (await readdir(resolve(root, "qa/import"))).filter((file) => file.endsWith(".txt")).sort()) {
  corpus.push({ name, text: await readFile(resolve(root, "qa/import", name), "utf8") });
}
const presetFile = JSON.parse(await readFile(resolve(root, "content/provider/presets.json"), "utf8"));
const presets = presetFile.presets;
const lineMap = JSON.parse(await readFile(resolve(root, "content/provider/template-lines.json"), "utf8"));
const covered = coveredSentences(lineMap);
const template = parseProviderBlock(await readFile(resolve(root, "content/provider/dot-phrase-draft.txt"), "utf8")).other;

// The labels the parser now drives on, measured from real handouts. A driving line is shown in the
// table rather than in a review list, so it is accounted for without appearing in one.
const DRIVING_LABEL = /^(antibiotics?|abx|pain( (medications?|medicines?|meds?|control|management|and discomfort))?|dealing with pain|follow[ -]?up( (visits?|appointments?))?|f\/u|fu|return to clinic|rtc|video guide|languages?|lang|guide language)\s*:/i;

// Everything the page can show back about the block, in one string.
function accountedFor(parsed) {
  return [...parsed.other.map((entry) => entry.text), ...parsed.unread, ...Object.values(parsed.unclear)].join("\n");
}

test("nothing a clinician wrote vanishes, in any shape of note", () => {
  for (const { name, text } of corpus) {
    const parsed = parseProviderBlock(text);
    const shown = accountedFor(parsed);
    const missing = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      // A driving line is accounted for by the table, and the review line by its own row.
      .filter((line) => !DRIVING_LABEL.test(stripBullet(line)) && !/^reviewed by/i.test(line))
      .filter((line) => !shown.includes(line));
    assert.deepEqual(missing, [], `${name}: ${missing.length} line(s) reach no list on the page`);
  }
});

test("every note in the corpus parses without throwing, and classifies every line it shows", () => {
  for (const { name, text } of corpus) {
    const parsed = parseProviderBlock(text);
    const statuses = lineStatuses(parsed.other, { template, covered, noteOnly: lineMap.note_only });
    assert.equal(statuses.length, parsed.other.length, `${name}: every line the page lists has a status`);
    for (const entry of statuses) assert.ok(["same", "changed", "not_covered", "note"].includes(entry.status), `${name}: ${entry.status}`);
    assert.ok(Array.isArray(missingFromBlock(parsed.other, { covered })), name);
  }
});

// The rest of this file is characterisation, not approval. It records what the page does today with a
// real practice's note so that changing it is a deliberate decision and not a surprise. Each assertion
// that describes a hazard says so.
test("a note that says the patient got no antibiotic no longer sends a=1", () => {
  const prose = corpus.find((entry) => entry.name === "s1-prose.txt").text;
  assert.match(prose, /did not send you home on an antibiotic/, "the clinician's own words say no antibiotic");

  const parsed = parseProviderBlock(prose);
  assert.deepEqual(parsed.fields, {}, "the parser reads nothing at all from unlabelled prose");
  assert.deepEqual(parsed.needs_choice, [], "and nothing about that absence asks the clinician to choose");

  // Fixed: the preset file is unapproved, so absence now has no author and the link is not built.
  const gated = applyPresets(parsed.fields, presets, { approved: presetFile.approved === true });
  assert.deepEqual([...gated.unauthored].sort(), ["antibiotic", "language", "pain_medication"], "the page asks instead of guessing");
  assert.throws(() => buildPatientLink(gated.values), /has no value/, "and no link can be built from what nobody authored");

  // What it used to do, kept so the regression is named: approve the placeholders and a=1 comes back.
  const ungated = applyPresets(parsed.fields, presets, { approved: true });
  assert.deepEqual([...ungated.from_presets].sort(), [...FIELD_ORDER].sort());
  assert.match(buildPatientLink(ungated.values), /a=1/, "an approved preset would still speak for a silent note");
});

test("a follow-up stated as an interval is read, because no real handout carries a date", () => {
  // Across 25 published post-operative instructions, 19 state a follow-up and 0 state a bookable date.
  // Demanding a date was demanding something the source never contains, and the two spellings below
  // used to behave differently: one blocked the link, the other was silently ignored.
  for (const line of ["Follow up: wound check in two to three weeks", "Follow-up appointment: 2 weeks post-op for wound check.", "FOLLOW UP:  Please arrange to see us 7-14 days after surgery."]) {
    const parsed = parseProviderBlock(line);
    assert.deepEqual(parsed.needs_choice, [], `${line} reads without asking`);
    assert.equal(parsed.fields.follow_up_date, null, "no date, and none invented");
    assert.ok(parsed.intervals.follow_up_date, `${line} yields an interval`);
  }
  assert.equal(parseProviderBlock("Follow up: two to three weeks").intervals.follow_up_date.days_to, 21);
  assert.equal(parseProviderBlock("FOLLOW UP: see us 7-14 days after surgery").intervals.follow_up_date.days_from, 7);

  // A label with its instruction in the block beneath is the commonest real shape: 12 of 25.
  const headed = parseProviderBlock(["Follow up:", "  \u2022 First visit in 1 week, again at 4 weeks"].join("\n"));
  assert.equal(headed.intervals.follow_up_date?.text, "1 week", "the block under the label is its value");
  assert.ok(headed.other.some((entry) => entry.text.includes("First visit")), "and the block is still listed as its own line");
});

test("a bullet or a list number in front of a label does not hide the label", () => {
  assert.equal(parseProviderBlock("\u2022 Antibiotics: Yes, cephalexin 500 mg").fields.antibiotic, true);
  assert.equal(parseProviderBlock("3. Antibiotic: No").fields.antibiotic, false);
  assert.deepEqual(parseProviderBlock("- Pain: Tylenol as needed").needs_choice, ["pain_medication"], "matched, and honestly unreadable as a yes or no");
  assert.ok(parseProviderBlock("\u2022 Antibiotics: Yes").other.length === 0);
});
