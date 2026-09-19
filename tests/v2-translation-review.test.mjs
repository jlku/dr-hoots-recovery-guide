// tests/v2-translation-review.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { PANEL_SIZE, REVIEWER_LABEL, buildPacket, packContentHash, panelErrors, panelReceiptPaths, receiptPath, validateReceipt } from "../scripts/lib/translation-review.mjs";

const root = resolve(import.meta.dirname, "..");

function passingReceipt(packet) {
  return {
    schema_version: "1.0",
    reviewer: packet.reviewer,
    kind: "ai",
    label: REVIEWER_LABEL,
    model: "claude-opus-5 (session subagent)",
    reviewed_on: "2026-09-18",
    target: packet.target,
    rubric: { id: packet.rubric.id, sha256: packet.rubric.sha256 },
    items: packet.items.map((item) => ({ id: item.id, kind: item.kind, verdict: "pass", criteria: Object.fromEntries(packet.rubric.criteria.map((criterion) => [criterion.id, "pass"])), note: "" })),
    findings: [],
    verdict: "pass"
  };
}

test("a packet lists every sentence and label with the pack's content hash", async () => {
  const packet = await buildPacket({ root, reviewer: "es" });
  assert.equal(packet.target.language, "es");
  assert.equal(packet.items.filter((item) => item.kind === "sentence").length, 27);
  assert.ok(packet.items.some((item) => item.id === "ov.fever" && item.kind === "label"));
  assert.match(packet.target.sha256, /^[0-9a-f]{64}$/);
  assert.equal(receiptPath("es", packet.target.sha256), `content/reviews/es/${packet.target.sha256.slice(0, 16)}.json`);
  const chinese = await buildPacket({ root, reviewer: "zh" });
  assert.equal(chinese.target.language, "zh-Hans");
  assert.equal(chinese.target.file, "content/translations/zh-Hans/ci-phase0-v0.1.0.json");
});

test("the content hash ignores status and review, so recording a review does not unbind it", () => {
  const pack = { language: "es", script: "Latn", sentences: { a: "x" }, labels: { b: "y" }, status: "machine_draft", review: {} };
  assert.equal(packContentHash(pack), packContentHash({ ...pack, status: "ai_reviewed", review: { receipt: "r" } }));
  assert.notEqual(packContentHash(pack), packContentHash({ ...pack, sentences: { a: "z" } }));
});

test("a receipt must bind to the pack, cover every item on every criterion, carry the AI label, and verdict by the rule", async () => {
  const packet = await buildPacket({ root, reviewer: "es" });
  assert.deepEqual(validateReceipt(passingReceipt(packet), packet), []);
  const wrongHash = { ...passingReceipt(packet), target: { ...packet.target, sha256: "0".repeat(64) } };
  assert.match(validateReceipt(wrongHash, packet).join("\n"), /does not bind to the current pack/);
  const unlabeled = { ...passingReceipt(packet), label: "Approved" };
  assert.match(validateReceipt(unlabeled, packet).join("\n"), /label must be/);
  const missing = passingReceipt(packet);
  missing.items = missing.items.filter((item) => item.id !== "wc.03");
  assert.match(validateReceipt(missing, packet).join("\n"), /does not review wc\.03/);
  const inconsistent = passingReceipt(packet);
  inconsistent.items[0].criteria.equivalence = "fail";
  assert.match(validateReceipt(inconsistent, packet).join("\n"), /item wc\.01 fails a criterion but is marked pass/);
  inconsistent.items[0].verdict = "fail";
  assert.match(validateReceipt(inconsistent, packet).join("\n"), /receipt verdict must be fail/);
  inconsistent.verdict = "fail";
  assert.match(validateReceipt(inconsistent, packet).join("\n"), /failing item wc\.01 needs a finding/);
  inconsistent.findings = [{ id: "wc.01", criterion: "equivalence", problem: "p", suggestion: "s" }];
  assert.deepEqual(validateReceipt(inconsistent, packet), [], "a failing receipt with its finding is valid evidence");
});

test("a pack counts as reviewed only when three independent reviewers each pass the same pack", async () => {
  const packet = await buildPacket({ root, reviewer: "es" });
  const hash = packet.target.sha256;
  const base = `content/reviews/es/${hash.slice(0, 16)}`;
  assert.equal(PANEL_SIZE, 3);
  assert.deepEqual(panelReceiptPaths("es", hash), [`${base}.json`, `${base}.2.json`, `${base}.3.json`]);
  assert.equal(receiptPath("es", hash, 2), `${base}.2.json`);
  const pass = () => passingReceipt(packet);
  assert.deepEqual(panelErrors([pass(), pass(), pass()], packet), []);
  assert.match(panelErrors([pass(), pass()], packet).join("\n"), /needs 3 independent passing receipts; 2 recorded/);
  const failing = pass();
  failing.items[0].verdict = "fail";
  failing.items[0].criteria.phrasing = "fail";
  failing.findings = [{ id: "wc.01", criterion: "phrasing", problem: "p", suggestion: "s" }];
  failing.verdict = "fail";
  assert.match(panelErrors([pass(), failing, pass()], packet).join("\n"), /reviewer 2 failed the pack/);
  const stale = { ...pass(), target: { ...packet.target, sha256: "0".repeat(64) } };
  assert.match(panelErrors([pass(), pass(), stale], packet).join("\n"), /reviewer 3: receipt does not bind to the current pack/);
});
