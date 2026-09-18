// tests/v2-spend-ledger.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { estimateFluxUsd, estimateNarrationUsd, ledgerTotals, loadLedger, reserveSpend, settleSpend, validateLedger } from "../scripts/lib/spend-ledger.mjs";

const root = resolve(import.meta.dirname, "..");

function fixture(cap = 1) {
  return { schema_version: "1.0", cap_usd: cap, authorized_by: "fixture", authorized_on: "2026-09-17", entries: [] };
}

test("estimates round up to the cent from published megapixel and character rates", () => {
  assert.equal(estimateFluxUsd({ outputMegapixels: 0.786 }), 0.03);
  assert.equal(estimateFluxUsd({ outputMegapixels: 1.05 }), 0.04);
  assert.equal(estimateFluxUsd({ outputMegapixels: 0.786, inputMegapixels: 0.786 }), 0.04);
  assert.equal(estimateNarrationUsd(2000), 0.2);
});

test("reservations count against the cap and refuse to cross it", () => {
  let ledger = reserveSpend(fixture(1), { id: "a", model: "fal-ai/flux-2-pro", purpose: "test", estimate_usd: 0.6 });
  assert.equal(ledgerTotals(ledger).committed, 0.6);
  assert.equal(ledgerTotals(ledger).remaining, 0.4);
  assert.throws(() => reserveSpend(ledger, { id: "b", model: "fal-ai/flux-2-pro", purpose: "test", estimate_usd: 0.5 }), /spend cap/);
  ledger = settleSpend(ledger, "a", { status: "failed" });
  assert.equal(ledgerTotals(ledger).committed, 0);
  ledger = reserveSpend(ledger, { id: "b", model: "fal-ai/flux-2-pro", purpose: "test", estimate_usd: 0.5 });
  ledger = settleSpend(ledger, "b", { status: "completed", requestId: "req-1", actualUsd: 0.45 });
  assert.equal(ledgerTotals(ledger).committed, 0.45);
  assert.equal(ledger.entries.at(-1).request_id, "req-1");
  assert.throws(() => settleSpend(ledger, "zzz", { status: "completed" }), /no ledger entry/);
  assert.throws(() => reserveSpend(ledger, { id: "c", model: "x", purpose: "t", estimate_usd: 0 }), /positive/);
});

test("validation catches duplicates, bad statuses, and an overspent ledger", () => {
  const ledger = fixture(0.05);
  ledger.entries.push({ id: "a", status: "completed", estimate_usd: 0.03, actual_usd: null }, { id: "a", status: "completed", estimate_usd: 0.03, actual_usd: null }, { id: "b", status: "weird", estimate_usd: 0.03, actual_usd: null });
  const result = validateLedger(ledger);
  assert.match(result.errors.join("\n"), /duplicate ledger entry a/);
  assert.match(result.errors.join("\n"), /bad status weird/);
  assert.match(result.errors.join("\n"), /exceeds the \$0.05 cap/);
});

test("the repository ledger is valid and capped at ten dollars", async () => {
  const ledger = await loadLedger(root);
  assert.equal(ledger.cap_usd, 10);
  assert.equal(validateLedger(ledger).valid, true);
});

test("a failed entry counts what it actually billed, and Claude calls are priced from reported usage", async () => {
  const { claudeUsd, estimateClaudeUsd, ledgerTotals: totals } = await import("../scripts/lib/spend-ledger.mjs");
  const ledger = { cap_usd: 10, entries: [
    { id: "a", status: "completed", estimate_usd: 1, actual_usd: 0.25 },
    { id: "b", status: "failed", estimate_usd: 1, actual_usd: 0.12 },
    { id: "c", status: "failed", estimate_usd: 1, actual_usd: null }
  ] };
  assert.equal(totals(ledger).committed, 0.37);
  assert.equal(claudeUsd({ model: "claude-opus-5", inputTokens: 1500, outputTokens: 900 }), 0.03);
  assert.equal(estimateClaudeUsd([{ model: "claude-opus-5", inputTokens: 6000, outputTokens: 16000 }]), 0.43);
  assert.throws(() => claudeUsd({ model: "claude-unknown", inputTokens: 1 }), /no price/);
});
