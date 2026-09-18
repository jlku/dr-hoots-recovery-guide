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
const validate = (overrides = {}) => validateInstructions({ instructions, canonical, segments: bundle.segments, frames, questions, root, ...overrides });

test("every canonical sentence is either an instruction with a claim or excused with a reason", async () => {
  const result = await validate();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(INSTRUCTION_STATUSES, ["placeholder", "text", "illustrated", "verified"]);
  assert.ok(result.summary.placeholder >= 3, "the unanswered how-tos stay placeholders until Song answers");
  for (const claim of instructions.claims.filter((item) => item.status === "verified")) assert.ok(claim.receipt, `${claim.id} verified with a receipt`);
});

test("the how-tos that depend on Song are placeholders that point at open questions", () => {
  for (const id of ["howto.clean-edges", "howto.apply-ointment", "howto.shower"]) {
    const claim = instructions.claims.find((item) => item.id === id);
    assert.equal(claim.status, "placeholder", id);
    assert.equal(questions.get(claim.open_question)?.status, "open", claim.open_question);
    assert.equal(claim.clinician_confirmed, false);
  }
  assert.deepEqual(pendingClaims(instructions, "frame-0203-paths").map((claim) => claim.id), ["howto.clean-edges", "howto.apply-ointment"]);
  assert.deepEqual(pendingClaims(instructions, "frame-01"), [], "bandage removal is pictured as a reviewed sequence");
  assert.deepEqual(pendingClaims(instructions, "frame-13-programming"), []);
});

test("the guard catches an unclaimed instruction, a placeholder without a question, a stale placeholder, and a frame that does not speak the sentence", async () => {
  const broken = structuredClone(instructions);
  broken.non_instruction_sentence_ids["act.02"] = undefined;
  delete broken.non_instruction_sentence_ids["act.02"];
  broken.claims.find((claim) => claim.id === "howto.shower").open_question = null;
  broken.claims.find((claim) => claim.id === "howto.check-tape").frame = "frame-13-programming";
  const verified = broken.claims.find((claim) => claim.id === "howto.apply-ointment");
  verified.status = "verified";
  const answered = new Map(questions);
  answered.set("q.cleaning-technique", { status: "answered" });
  const result = await validate({ instructions: broken, questions: answered });
  const text = result.errors.join("\n");
  assert.match(text, /act\.02 is neither an instruction nor excused/);
  assert.match(text, /howto\.shower is a placeholder without an open question/);
  assert.match(text, /howto\.check-tape: wc\.02 is not spoken by a beat that uses frame-13-programming/);
  assert.match(text, /howto\.apply-ointment is verified without a receipt/);
  assert.match(text, /howto\.clean-edges is still a placeholder but q\.cleaning-technique is answered/);
});

test("the clinician question list parses ids and statuses from bullets", () => {
  const parsed = parseQuestions("# x\n- `q.one` (open, asked 2026-09-17) — text\n- `q.two` (answered 2026-09-18) — text\n- not a question\n");
  assert.deepEqual([...parsed.entries()], [["q.one", { status: "open" }], ["q.two", { status: "answered" }]]);
  assert.ok(questions.size >= 6);
});

test("the verified motion claim carries a sequence receipt with both verdicts and the observers' instruction answers", async () => {
  const claim = instructions.claims.find((item) => item.id === "howto.remove-dressing");
  assert.equal(claim.status, "verified");
  assert.equal(claim.clinician_confirmed, false, "observers can tell what to do; the clinician has not confirmed the how");
  const receipt = JSON.parse(await readFile(resolve(root, claim.receipt), "utf8"));
  assert.equal(receipt.adjudication.verdict, "pass");
  assert.equal(receipt.adjudication.verdict_strict, "fail", "the strict verdict is kept visible while the instruction-sequence rule awaits sign-off");
  assert.equal(receipt.panels.length, 3);
  assert.ok(receipt.observers.every((observer) => /coming off/i.test(observer.observation)));
  assert.ok(receipt.adjudication.design_notes.length > 0);
});
