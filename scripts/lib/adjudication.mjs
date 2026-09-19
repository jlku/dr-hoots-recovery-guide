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
import { SONG_DIR, SONG_LABEL, songPanelPaths } from "./song-review.mjs";
import { REVIEWER_LABEL, TRANSLATION_REVIEWERS, panelReceiptPaths } from "./translation-review.mjs";

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
  // Language review receipts: each is named by the pack hash it binds to and its panel slot, carries the AI label, and
  // records a verdict that follows from its items. Receipts for earlier hashes stay as history.
  summary.translations = 0;
  for (const [reviewer, config] of Object.entries(TRANSLATION_REVIEWERS)) {
    const files = await readdir(join(root, config.dir)).then((list) => list.filter((name) => name.endsWith(".json")), () => []);
    for (const name of files) {
      const file = `${config.dir}/${name}`;
      const receipt = JSON.parse(await readFile(join(root, file), "utf8"));
      summary.translations += 1;
      if (!panelReceiptPaths(reviewer, receipt.target?.sha256 ?? "").includes(file)) errors.push(`${file} is not named by the pack hash it binds to`);
      if (receipt.label !== REVIEWER_LABEL) errors.push(`${file} must carry the label "${REVIEWER_LABEL}"`);
      const allPass = Array.isArray(receipt.items) && receipt.items.length > 0 && receipt.items.every((item) => item.verdict === "pass");
      if ((receipt.verdict === "pass") !== allPass) errors.push(`${file} verdict does not follow from its items`);
    }
  }
  // Simulated Song review receipts: named by the build hash and panel slot, labeled, stored with the
  // measured facts, and never passing a check whose fact failed.
  summary.song = 0;
  const songFiles = await readdir(join(root, SONG_DIR)).then((list) => list.filter((name) => name.endsWith(".json")), () => []);
  for (const name of songFiles) {
    const file = `${SONG_DIR}/${name}`;
    const receipt = JSON.parse(await readFile(join(root, file), "utf8"));
    summary.song += 1;
    if (!songPanelPaths(receipt.target?.sha256 ?? "").includes(file)) errors.push(`${file} is not named by the build hash it binds to`);
    if (receipt.label !== SONG_LABEL) errors.push(`${file} must carry the label "${SONG_LABEL}"`);
    const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
    const allPass = checks.length > 0 && checks.every((check) => check.verdict === "pass");
    if ((receipt.verdict === "pass") !== allPass) errors.push(`${file} verdict does not follow from its checks`);
    for (const check of checks) {
      if (check.verdict === "pass" && receipt.facts?.[check.id]?.ok === false) errors.push(`${file} passes ${check.id} although its measured fact failed`);
    }
  }
  return { valid: errors.length === 0, errors, summary };
}
