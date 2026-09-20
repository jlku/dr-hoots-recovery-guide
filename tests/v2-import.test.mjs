// tests/v2-import.test.mjs
// The flow nobody had tested: a clinician pastes the after-visit summary their practice already uses,
// which is not this project's draft template. See qa/import/README.md.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { FIELD_ORDER, applyPresets, buildPatientLink, coveredSentences, lineStatuses, missingFromBlock, parseProviderBlock } from "../guide/assets/provider.js";

const root = resolve(import.meta.dirname, "..");
const corpus = [];
for (const name of (await readdir(resolve(root, "qa/import"))).filter((file) => file.endsWith(".txt")).sort()) {
  corpus.push({ name, text: await readFile(resolve(root, "qa/import", name), "utf8") });
}
const presets = JSON.parse(await readFile(resolve(root, "content/provider/presets.json"), "utf8")).presets;
const lineMap = JSON.parse(await readFile(resolve(root, "content/provider/template-lines.json"), "utf8"));
const covered = coveredSentences(lineMap);
const template = parseProviderBlock(await readFile(resolve(root, "content/provider/dot-phrase-draft.txt"), "utf8")).other;

const DRIVING_LABEL = /^(antibiotics?|abx|pain (medications?|medicines?|meds?)|follow[ -]?up|f\/u|fu|video guide|languages?|lang|guide language)\s*:/i;

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
      .filter((line) => !DRIVING_LABEL.test(line) && !/^reviewed by/i.test(line))
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
test("HAZARD, recorded: a note that says the patient got no antibiotic still sends a=1, from a placeholder", () => {
  const prose = corpus.find((entry) => entry.name === "s1-prose.txt").text;
  assert.match(prose, /did not send you home on an antibiotic/, "the clinician's own words say no antibiotic");

  const parsed = parseProviderBlock(prose);
  assert.deepEqual(parsed.fields, {}, "the parser reads nothing at all from unlabelled prose");
  assert.deepEqual(parsed.needs_choice, [], "and nothing about that absence asks the clinician to choose");

  const { values, from_presets: fromPresets } = applyPresets(parsed.fields, presets);
  assert.deepEqual([...fromPresets].sort(), [...FIELD_ORDER].sort(), "every driving value comes from the preset file");
  assert.equal(values.antibiotic, true);
  assert.match(buildPatientLink(values), /a=1/, "so the patient is told to take an antibiotic they were never prescribed");
});

test("HAZARD, recorded: one extra word in a label decides whether the page blocks or guesses", () => {
  const blocked = parseProviderBlock("Follow up: wound check in two to three weeks");
  assert.deepEqual(blocked.needs_choice, ["follow_up_date"], "'Follow up:' with no date blocks the link");

  const silent = parseProviderBlock("Follow-up appointment: 2 weeks post-op for wound check.");
  assert.deepEqual(silent.needs_choice, [], "'Follow-up appointment:' — the same clinical fact — asks nothing");
  assert.equal("follow_up_date" in silent.fields, false, "and reads no date either, so the preset applies silently");
});
