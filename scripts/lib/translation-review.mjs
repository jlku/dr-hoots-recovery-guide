// scripts/lib/translation-review.mjs
// AI language review of a translation pack: the packet a reviewer reads, and the rules its receipt
// must meet. A receipt binds to the pack's content hash, so any edit to a sentence or label needs a
// new review.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalSentenceText } from "./language-packs.mjs";
import { canonicalSentenceOrder } from "./segments.mjs";

export const REVIEWER_LABEL = "AI reviewer (Claude), not a certified medical translator";
export const TRANSLATION_REVIEWERS = Object.freeze({
  es: { language: "es", dir: "content/reviews/es" },
  zh: { language: "zh-Hans", dir: "content/reviews/zh" }
});
const ARTIFACT = "ci-phase0-v0.1.0";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const sorted = (object) => Object.fromEntries(Object.keys(object ?? {}).sort().map((key) => [key, object[key]]));

// Only what the reviewer judged: status and the review block change when a review is recorded.
export function packContentHash(pack) {
  return sha256(JSON.stringify({ language: pack.language, script: pack.script, sentences: sorted(pack.sentences), labels: sorted(pack.labels) }));
}

export function receiptPath(reviewer, hash) {
  return `${TRANSLATION_REVIEWERS[reviewer].dir}/${hash.slice(0, 16)}.json`;
}

export function reviewerForLanguage(language) {
  return Object.entries(TRANSLATION_REVIEWERS).find(([, config]) => config.language === language)?.[0] ?? null;
}

export async function buildPacket({ root, reviewer }) {
  const config = TRANSLATION_REVIEWERS[reviewer];
  if (!config) throw new Error(`unknown reviewer ${reviewer}; use one of ${Object.keys(TRANSLATION_REVIEWERS).join(", ")}`);
  const file = `content/translations/${config.language}/${ARTIFACT}.json`;
  const [packText, englishText, canonicalText, rubricText, persona] = await Promise.all([
    readFile(join(root, file), "utf8"),
    readFile(join(root, `content/translations/en/${ARTIFACT}.json`), "utf8"),
    readFile(join(root, `content/canonical/${ARTIFACT}.json`), "utf8"),
    readFile(join(root, `reviewers/${reviewer}/rubric.json`), "utf8"),
    readFile(join(root, `reviewers/${reviewer}/persona.md`), "utf8")
  ]);
  const pack = JSON.parse(packText);
  const english = JSON.parse(englishText);
  const canonical = JSON.parse(canonicalText);
  const rubric = JSON.parse(rubricText);
  const source = canonicalSentenceText(canonical);
  const items = [
    ...canonicalSentenceOrder(canonical).map((id) => ({ id, kind: "sentence", source: source.get(id), translation: pack.sentences?.[id] ?? null })),
    ...Object.keys(english.labels).map((id) => ({ id, kind: "label", source: english.labels[id], translation: pack.labels?.[id] ?? null }))
  ];
  return {
    reviewer,
    persona,
    target: { file, language: pack.language, sha256: packContentHash(pack) },
    rubric: { id: rubric.id, sha256: sha256(rubricText), criteria: rubric.criteria, verdict_rule: rubric.verdict_rule },
    items,
    receipt_format: {
      schema_version: "1.0",
      reviewer,
      kind: "ai",
      label: REVIEWER_LABEL,
      model: "<the model you are>",
      reviewed_on: "<YYYY-MM-DD>",
      target: "<copy the packet's target object exactly>",
      rubric: "<an object with the packet rubric's id and sha256, copied exactly>",
      items: "[{ id, kind, verdict: pass|fail, criteria: { <each criterion id>: pass|fail }, note }] for every packet item, in packet order",
      findings: "[{ id, criterion, problem, suggestion }] for every failing criterion; the suggestion is corrected translated text",
      verdict: "pass only when every item passes, otherwise fail"
    }
  };
}

export function validateReceipt(receipt, packet) {
  const errors = [];
  if (receipt?.reviewer !== packet.reviewer) errors.push(`receipt reviewer must be ${packet.reviewer}`);
  if (receipt?.kind !== "ai") errors.push("receipt kind must be ai");
  if (receipt?.label !== REVIEWER_LABEL) errors.push(`receipt label must be "${REVIEWER_LABEL}"`);
  if (!receipt?.model) errors.push("receipt needs the reviewing model");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receipt?.reviewed_on ?? "")) errors.push("receipt needs reviewed_on as YYYY-MM-DD");
  if (receipt?.target?.sha256 !== packet.target.sha256 || receipt?.target?.file !== packet.target.file) errors.push("receipt does not bind to the current pack; review the pack again");
  if (receipt?.rubric?.id !== packet.rubric.id || receipt?.rubric?.sha256 !== packet.rubric.sha256) errors.push("receipt does not use the current rubric");
  const criteria = packet.rubric.criteria.map((criterion) => criterion.id);
  const items = Array.isArray(receipt?.items) ? receipt.items : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  if (byId.size !== items.length) errors.push("receipt reviews an item twice");
  const failing = [];
  let inconsistent = false;
  for (const expected of packet.items) {
    const item = byId.get(expected.id);
    if (!item) {
      errors.push(`receipt does not review ${expected.id}`);
      continue;
    }
    for (const criterion of criteria) {
      if (!["pass", "fail"].includes(item.criteria?.[criterion])) errors.push(`item ${expected.id} needs ${criterion}: pass or fail`);
    }
    const allPass = criteria.every((criterion) => item.criteria?.[criterion] === "pass");
    if (item.verdict === "pass" && !allPass) {
      errors.push(`item ${expected.id} fails a criterion but is marked pass`);
      inconsistent = true;
    }
    if (item.verdict === "fail") failing.push(expected.id);
    else if (item.verdict !== "pass") errors.push(`item ${expected.id} needs a verdict of pass or fail`);
  }
  for (const id of byId.keys()) if (!packet.items.some((item) => item.id === id)) errors.push(`receipt reviews unknown item ${id}`);
  const expectedVerdict = failing.length || inconsistent ? "fail" : "pass";
  if (receipt?.verdict !== expectedVerdict) errors.push(`receipt verdict must be ${expectedVerdict}`);
  for (const id of failing) {
    if (!(receipt?.findings ?? []).some((finding) => finding.id === id)) errors.push(`failing item ${id} needs a finding`);
  }
  return errors;
}
