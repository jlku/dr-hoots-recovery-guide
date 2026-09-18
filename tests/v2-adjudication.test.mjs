import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { adjudicate, receiptVerdictErrors, validateReviews } from "../scripts/lib/adjudication.mjs";

const root = resolve(import.meta.dirname, "..");
const required = ["dressing covers the ear", "hand takes the gauze away", "bare head", "the dressing comes off"];
const all = [...required];
const reverse = { key: "reverse-action", reading: "could read as tying the band on", forbidden: "the dressing being put on", harm: false };
const observer = (overrides = {}) => ({ recovered: all, own_forbidden: [], alternatives: [], unallowed_marks: [], ...overrides });

test("a reversible action passes when every observer names the reverse only as the forced alternative", () => {
  const result = adjudicate({ required, observers: [observer({ alternatives: [reverse] }), observer({ alternatives: [reverse] }), observer({ alternatives: [reverse] })] });
  assert.equal(result.verdict, "pass");
  assert.equal(result.verdict_strict, "fail", "the strict rule still records that the reverse was named");
  assert.equal(result.design_notes.length, 3, "every alternative reaches the clinician");
});

test("a harmful alternative named by two or more observers fails the card, as the throat and cut-here readings did", () => {
  const throat = { key: "cloth-at-throat", reading: "cloth pulled across the throat", forbidden: null, harm: true };
  const cutHere = { key: "cut-here", reading: "the dashed line could read as cut here", forbidden: "scissors or cutting", harm: true };
  assert.equal(adjudicate({ required, observers: [observer({ alternatives: [throat] }), observer({ alternatives: [throat] }), observer()] }).verdict, "fail");
  assert.equal(adjudicate({ required, observers: [observer({ alternatives: [cutHere] }), observer({ alternatives: [cutHere] }), observer({ alternatives: [cutHere] })] }).verdict, "fail");
});

test("one observer's harmful alternative is a design note, not a failure, and the strict rule still fails it", () => {
  const wound = { key: "strip-as-wound", reading: "the tan strip could pass for a wound", forbidden: "the ear injured or bleeding", harm: true };
  const result = adjudicate({ required, observers: [observer({ alternatives: [wound, reverse] }), observer(), observer()] });
  assert.equal(result.verdict, "pass");
  assert.equal(result.verdict_strict, "fail");
});

test("two observers sharing a harmless alternative do not fail the card", () => {
  const applyTape = { key: "apply-tape", reading: "could read as an order to stick tape on", forbidden: null, harm: false };
  const result = adjudicate({ required, observers: [observer(), observer({ alternatives: [applyTape] }), observer({ alternatives: [applyTape] })] });
  assert.equal(result.verdict, "pass");
  assert.equal(result.verdict_strict, "pass");
});

test("a missed item, a forbidden reading in the observer's own answer, or an unallowed mark fails under both rules", () => {
  const missing = adjudicate({ required, observers: [observer(), observer(), observer({ recovered: required.slice(0, 3) })] });
  assert.deepEqual(missing.missed, ["the dressing comes off"]);
  assert.equal(missing.verdict, "fail");
  assert.equal(adjudicate({ required, observers: [observer({ own_forbidden: ["the band is being tied on"] }), observer(), observer()] }).verdict, "fail");
  const marked = adjudicate({ required, observers: [observer({ unallowed_marks: ["the word PULL"] }), observer(), observer()] });
  assert.equal(marked.verdict, "fail");
  assert.equal(marked.verdict_strict, "fail");
});

test("state pictures use the strict rule, and the panel must be three observers", () => {
  const result = adjudicate({ required, rule: "strict", observers: [observer({ alternatives: [reverse] }), observer(), observer()] });
  assert.equal(result.verdict, "fail");
  assert.throws(() => adjudicate({ required, observers: [observer(), observer()] }), /exactly three observers/);
});

test("every receipt in the repository records a verdict that follows from its own findings", async () => {
  const result = await validateReviews(root);
  assert.deepEqual(result.errors, []);
  assert.ok(result.summary.receipts >= 14);
  assert.ok(result.summary.strict_kept >= 1, "instruction-picture passes keep their strict verdict visible");
  const card = JSON.parse(await readFile(resolve(root, "content/reviews/anatomy/diagram.remove-dressing.json"), "utf8"));
  assert.deepEqual(receiptVerdictErrors(card), []);
  const tampered = structuredClone(card);
  tampered.adjudication.verdict_strict = "pass";
  tampered.adjudication.forbidden_hits = ["a hit that the verdict ignores"];
  const text = receiptVerdictErrors(tampered).join("\n");
  assert.match(text, /verdict pass does not follow from 0 missed items and 1 forbidden hits/);
  assert.match(text, /strict verdict pass does not follow/);
});

test("a hedge the observer sets aside fails only the strict rule, and reaches the clinician as a note", () => {
  const result = adjudicate({ required, observers: [observer({ hedges: ["the dressing being put on"] }), observer(), observer()] });
  assert.equal(result.verdict, "pass");
  assert.equal(result.verdict_strict, "fail");
  assert.ok(result.design_notes.some((note) => /set aside: the dressing being put on/.test(note)));
  assert.equal(adjudicate({ required, rule: "strict", observers: [observer({ hedges: ["x"] }), observer(), observer()] }).verdict, "fail");
});

test("state pictures fail for what observers report seeing; imagined misreadings and set-aside hedges are notes", () => {
  const eyePatch = { key: "eye-patch", reading: "the pad is a patch over the eye", forbidden: "the ear uncovered", harm: true };
  const shared = [observer({ alternatives: [eyePatch] }), observer({ alternatives: [eyePatch] }), observer({ alternatives: [eyePatch], hedges: ["the dressing being put on"] })];
  const state = adjudicate({ required, rule: "state-picture", observers: shared });
  assert.equal(state.verdict, "pass", "even a harmful misreading all three share is a note on a state picture");
  assert.equal(state.verdict_strict, "fail");
  assert.equal(adjudicate({ required, rule: "instruction-picture", observers: shared }).verdict, "fail", "on an instruction card the same shared harmful misreading fails it");
  assert.ok(state.design_notes.some((note) => /patch over the eye/.test(note)) && state.design_notes.some((note) => /set aside/.test(note)));
  assert.equal(adjudicate({ required, rule: "state-picture", observers: [observer({ own_forbidden: ["the ear uncovered"] }), observer(), observer()] }).verdict, "fail", "what an observer reports seeing still fails it");
  assert.equal(adjudicate({ required, rule: "state-picture", observers: [observer({ unallowed_marks: ["a label"] }), observer(), observer()] }).verdict, "fail");
  assert.equal(adjudicate({ required, rule: "state-picture", observers: [observer({ recovered: required.slice(1) }), observer(), observer()] }).verdict, "fail");
});
