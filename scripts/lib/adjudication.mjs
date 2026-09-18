// The verdict rules in code. A reviewer decides what each observer's words mean; this decides what
// follows from that, so a verdict can never drift from the findings recorded beside it.
//
// Three rules, each computed from the same coded findings.
//
// State pictures (placeholder, approved for now by John on 2026-09-18; Song's sign-off is question
// q.state-picture-misreadings): a picture that shows a body part in a state fails for what observers
// report seeing: a required item fewer than three of them recover, a forbidden reading in their own
// answers, or a mark that should not be there. Imagined misreadings from question 4 and hedges they
// set aside are notes for the clinician. On these pictures a misreading changes how alarmed a viewer
// feels, not what they do, and requiring none failed every accepted state picture in the first live
// calibration.
//
// Instruction pictures (placeholder, approved for now by John on 2026-09-18; Song's sign-off is
// q.instruction-picture-rule): the same, and a misreading also fails the card when two or more
// observers name the same one and a viewer who believed it might do something harmful, such as cut,
// pull at the skin, tie something at the throat, or act on the wrong body part. A misreading that only
// looks alarming, such as a line that looks like a wound, is a note. That caught gauze read as cloth at the throat and a strip read as "cut here". Asked for an
// alternative to a reversible action, observers always name the reverse, so that alone cannot fail it.
//
// Strict (kept as a reference verdict on every receipt): any forbidden reading anywhere, including a
// hedge or a misreading, fails the picture.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const ADJUDICATION_RULES = Object.freeze(["state-picture", "instruction-picture", "strict"]);
export const REVIEWS_INDEX = "content/reviews/index.json";
export const RECEIPTS_DIR = "content/reviews/anatomy";
export const CALIBRATION_DIR = "content/reviews/calibration";

const hit = (alternative) => ({ observer: alternative.observer, reading: alternative.reading ?? alternative.key, source: "question 4" });

export function adjudicate({ required, observers, rule = "instruction-picture" }) {
  if (!ADJUDICATION_RULES.includes(rule)) throw new Error(`unknown rule ${rule}`);
  if (!Array.isArray(observers) || observers.length !== 3) throw new Error("adjudication needs exactly three observers");
  const missed = required.filter((item) => !observers.every((observer) => (observer.recovered ?? []).includes(item)));
  const own = observers.flatMap((observer, index) => (observer.own_forbidden ?? []).map((reading) => ({ observer: index + 1, reading, source: "own reading" })));
  const marks = observers.flatMap((observer, index) => (observer.unallowed_marks ?? []).map((mark) => ({ observer: index + 1, reading: `unallowed mark: ${mark}`, source: "question 3" })));
  const hedges = observers.flatMap((observer, index) => (observer.hedges ?? []).map((reading) => ({ observer: index + 1, reading, source: "hedge" })));
  const alternatives = observers.flatMap((observer, index) => (observer.alternatives ?? []).map((alternative) => ({ observer: index + 1, ...alternative })));
  const namedBy = new Map();
  for (const alternative of alternatives) namedBy.set(alternative.key, new Set([...(namedBy.get(alternative.key) ?? []), alternative.observer]));
  const sharedHarm = alternatives.filter((alternative) => alternative.harm && namedBy.get(alternative.key).size >= 2);
  const anyForbidden = alternatives.filter((alternative) => alternative.forbidden);
  const forbiddenHitsStrict = [...own, ...marks, ...hedges, ...anyForbidden.map(hit)];
  const forbiddenHits = rule === "strict" ? forbiddenHitsStrict : rule === "instruction-picture" ? [...own, ...marks, ...sharedHarm.map(hit)] : [...own, ...marks];
  return {
    rule,
    verdict: missed.length === 0 && forbiddenHits.length === 0 ? "pass" : "fail",
    verdict_strict: missed.length === 0 && forbiddenHitsStrict.length === 0 ? "pass" : "fail",
    missed,
    forbidden_hits: forbiddenHits,
    forbidden_hits_strict: forbiddenHitsStrict,
    design_notes: [
      ...alternatives.map((alternative) => `Observer ${alternative.observer}: ${alternative.reading ?? alternative.key}`),
      ...hedges.map((hedge) => `Observer ${hedge.observer} raised and set aside: ${hedge.reading}`)
    ]
  };
}

export function receiptVerdictErrors(doc) {
  const errors = [];
  const id = doc.record_id ?? "(unnamed receipt)";
  if ((doc.observers ?? []).length !== 3) errors.push(`${id}: a receipt needs three observers`);
  if (doc.clinician_review?.status !== "pending" && !doc.clinician_review?.reviewer) errors.push(`${id}: a clinician review that is not pending needs a reviewer`);
  const adjudication = doc.adjudication;
  if (!adjudication) return errors;
  const clean = (list) => (list ?? []).length === 0;
  const expected = clean(adjudication.missed) && clean(adjudication.forbidden_hits) ? "pass" : "fail";
  if (adjudication.verdict !== expected) errors.push(`${id}: verdict ${adjudication.verdict} does not follow from ${(adjudication.missed ?? []).length} missed items and ${(adjudication.forbidden_hits ?? []).length} forbidden hits`);
  if ("verdict_strict" in adjudication) {
    const strict = clean(adjudication.missed) && clean(adjudication.forbidden_hits_strict) ? "pass" : "fail";
    if (adjudication.verdict_strict !== strict) errors.push(`${id}: strict verdict ${adjudication.verdict_strict} does not follow from its recorded findings`);
    if (adjudication.verdict === "pass" && adjudication.verdict_strict === "fail" && clean(adjudication.design_notes)) errors.push(`${id}: a pass that fails the strict rule must carry design notes for the clinician`);
  }
  return errors;
}

export async function validateReviews(root) {
  const errors = [];
  const index = JSON.parse(await readFile(join(root, REVIEWS_INDEX), "utf8"));
  const listed = new Set(index.anatomy ?? []);
  const present = (await readdir(join(root, RECEIPTS_DIR))).filter((name) => name.endsWith(".json")).map((name) => `${RECEIPTS_DIR}/${name}`);
  for (const file of present) if (!listed.has(file)) errors.push(`${file} is not listed in ${REVIEWS_INDEX}`);
  const summary = { receipts: 0, pass: 0, fail: 0, strict_kept: 0 };
  for (const file of listed) {
    let doc;
    try {
      doc = JSON.parse(await readFile(join(root, file), "utf8"));
    } catch {
      errors.push(`${file} is listed but missing`);
      continue;
    }
    summary.receipts += 1;
    if (doc.adjudication?.verdict === "pass") summary.pass += 1;
    if (doc.adjudication?.verdict === "fail") summary.fail += 1;
    if (doc.adjudication && "verdict_strict" in doc.adjudication) summary.strict_kept += 1;
    errors.push(...receiptVerdictErrors(doc));
  }
  const calibration = join(root, CALIBRATION_DIR);
  let names = [];
  try {
    names = (await readdir(calibration, { recursive: true })).filter((name) => name.endsWith(".json"));
  } catch {
    names = [];
  }
  for (const name of names) {
    const doc = JSON.parse(await readFile(join(calibration, name), "utf8"));
    if (!doc.adjudication || !doc.observers) continue;
    summary.calibration = (summary.calibration ?? 0) + 1;
    errors.push(...receiptVerdictErrors(doc).map((error) => `calibration ${name}: ${error}`));
  }
  return { valid: errors.length === 0, errors, summary };
}
