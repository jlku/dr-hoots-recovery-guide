// tests/v2-template-lines.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { templateLineErrors } from "../scripts/validate-template-lines.mjs";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const input = {
  map: await readJson("content/provider/template-lines.json"),
  canonical: await readJson("content/canonical/ci-phase0-v0.1.0.json"),
  segments: await readJson("content/segments/ci-phase0-v0.1.0.segments.json"),
  draft: await readFile(resolve(root, "content/provider/dot-phrase-draft.txt"), "utf8")
};
const clone = (value) => JSON.parse(JSON.stringify(value));

test("every canonical sentence belongs to a line of the block, or the map says why it does not", () => {
  const { errors } = templateLineErrors(input);
  assert.deepEqual(errors, []);
});

test("a sentence a patient's link can change may not speak a number", () => {
  const map = clone(input.map);
  const canonical = clone(input.canonical);
  // Put the interval back into the follow-up sentence: the defect three walkthrough users hit, where
  // the guide said "about two weeks" and the link set October 15th.
  for (const module of canonical.modules) {
    for (const sentence of module.canonical_sentences) {
      if (sentence.id === "wc.09") sentence.text = "Your wound check and ear exam is about two weeks after surgery.";
    }
  }
  const { errors } = templateLineErrors({ ...input, map, canonical });
  assert.equal(errors.length, 1, errors.join("; "));
  assert.match(errors[0], /wc\.09 speaks a number in a sentence the "follow up" field can change/);
});

test("a covered line that owns nothing, and a sentence no line owns, both fail", () => {
  const empty = clone(input.map);
  empty.covered.shower.sentences = [];
  assert.ok(templateLineErrors({ ...input, map: empty }).errors.some((error) => /"shower" owns no canonical sentence/.test(error)));
  assert.ok(templateLineErrors({ ...input, map: empty }).errors.some((error) => /wc\.08 belongs to no line/.test(error)));

  const orphaned = clone(input.map);
  delete orphaned.guide_only["wc.10"];
  assert.ok(templateLineErrors({ ...input, map: orphaned }).errors.some((error) => /wc\.10 belongs to no line of the block/.test(error)));

  const doubled = clone(input.map);
  doubled.covered.dressing.sentences.push("wc.08");
  assert.ok(templateLineErrors({ ...input, map: doubled }).errors.some((error) => /wc\.08 belongs to two lines/.test(error)));
});

test("a line the map claims but the draft does not have fails, so the map cannot drift from the practice's block", () => {
  const map = clone(input.map);
  map.covered.lifting = { sentences: ["wc.08"], numbers: "practice" };
  const { errors } = templateLineErrors({ ...input, map });
  assert.ok(errors.some((error) => /covered line "lifting" is not a line of the draft dot phrase/.test(error)));
});
