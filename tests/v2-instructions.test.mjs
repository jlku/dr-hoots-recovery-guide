import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadFrameManifest } from "../scripts/lib/frames.mjs";
import { INSTRUCTION_STATUSES, loadInstructions, loadQuestions, parseQuestions, pendingClaims, validateInstructions } from "../scripts/lib/instructions.mjs";
import { loadSegmentBundle } from "../scripts/lib/segments.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const canonical = JSON.parse(await readFile(resolve(root, "content/canonical/ci-phase0-v0.1.0.json"), "utf8"));
const frames = await loadFrameManifest(root);
const instructions = await loadInstructions(root);
const questions = await loadQuestions(root);
const validate = (overrides = {}) => validateInstructions({ instructions, canonical, segments: bundle.segments, frames, questions, ...overrides });

test("every canonical sentence is either an instruction with a claim or excused with a reason", () => {
  const result = validate();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(INSTRUCTION_STATUSES, ["placeholder", "text", "illustrated", "verified"]);
  assert.ok(result.summary.placeholder >= 3, "the unanswered how-tos stay placeholders until Song answers");
  assert.equal(result.summary.verified, 0, "nothing is verified until an observer answers what to do from the picture");
});

test("the how-tos that depend on Song are placeholders that point at open questions", () => {
  for (const id of ["howto.remove-dressing", "howto.clean-edges", "howto.apply-ointment"]) {
    const claim = instructions.claims.find((item) => item.id === id);
    assert.equal(claim.status, "placeholder", id);
    assert.equal(questions.get(claim.open_question)?.status, "open", claim.open_question);
    assert.equal(claim.clinician_confirmed, false);
  }
  assert.deepEqual(pendingClaims(instructions, "frame-01").map((claim) => claim.id), ["howto.remove-dressing"]);
  assert.deepEqual(pendingClaims(instructions, "frame-13-programming"), []);
});

test("the guard catches an unclaimed instruction, a placeholder without a question, a stale placeholder, and a frame that does not speak the sentence", () => {
  const broken = structuredClone(instructions);
  broken.non_instruction_sentence_ids["act.02"] = undefined;
  delete broken.non_instruction_sentence_ids["act.02"];
  broken.claims.find((claim) => claim.id === "howto.remove-dressing").open_question = null;
  broken.claims.find((claim) => claim.id === "howto.shower").frame = "frame-13-programming";
  const verified = broken.claims.find((claim) => claim.id === "howto.apply-ointment");
  verified.status = "verified";
  const answered = new Map(questions);
  answered.set("q.cleaning-technique", { status: "answered" });
  const result = validate({ instructions: broken, questions: answered });
  const text = result.errors.join("\n");
  assert.match(text, /act\.02 is neither an instruction nor excused/);
  assert.match(text, /howto\.remove-dressing is a placeholder without an open question/);
  assert.match(text, /howto\.shower: wc\.08 is not spoken by a beat that uses frame-13-programming/);
  assert.match(text, /howto\.apply-ointment is verified without a receipt/);
  assert.match(text, /howto\.clean-edges is still a placeholder but q\.cleaning-technique is answered/);
});

test("the clinician question list parses ids and statuses from bullets", () => {
  const parsed = parseQuestions("# x\n- `q.one` (open, asked 2026-09-17) — text\n- `q.two` (answered 2026-09-18) — text\n- not a question\n");
  assert.deepEqual([...parsed.entries()], [["q.one", { status: "open" }], ["q.two", { status: "answered" }]]);
  assert.ok(questions.size >= 6);
});
