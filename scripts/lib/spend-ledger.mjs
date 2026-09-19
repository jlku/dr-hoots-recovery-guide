// scripts/lib/spend-ledger.mjs
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LEDGER_PATH = "content/spend/v2-ledger.json";
export const PRICING = Object.freeze({
  verifiedOn: "2026-09-17",
  flux2ProFirstMegapixelUsd: 0.03,
  flux2ProAdditionalMegapixelUsd: 0.015,
  elevenV3PerThousandCharactersUsd: 0.1
});
// Claude API list prices per million tokens (first-party API), from the claude-api reference cached
// 2026-06-24. A model that is not listed cannot be spent on until its price is added here.
export const CLAUDE_PRICING = Object.freeze({
  verifiedOn: "2026-06-24",
  perMillionUsd: Object.freeze({
    "claude-fable-5-1": Object.freeze({ input: 10, output: 50 }),
    "claude-opus-5": Object.freeze({ input: 5, output: 25 }),
    "claude-opus-4-8": Object.freeze({ input: 5, output: 25 }),
    "claude-sonnet-5": Object.freeze({ input: 2, output: 10 }),
    "claude-haiku-4-5": Object.freeze({ input: 1, output: 5 })
  })
});
const COUNTED = new Set(["reserved", "completed"]);
const STATUSES = new Set(["reserved", "completed", "failed"]);
const roundUpCents = (value) => Math.ceil(value * 100 - 1e-9) / 100;
const round = (value) => Number(value.toFixed(2));

export function estimateFluxUsd({ outputMegapixels, inputMegapixels = 0 }) {
  const total = outputMegapixels + inputMegapixels;
  return roundUpCents(PRICING.flux2ProFirstMegapixelUsd + Math.max(0, total - 1) * PRICING.flux2ProAdditionalMegapixelUsd);
}

export function estimateNarrationUsd(characters) {
  return roundUpCents((characters / 1000) * PRICING.elevenV3PerThousandCharactersUsd);
}

export function claudePrice(model) {
  const price = CLAUDE_PRICING.perMillionUsd[model];
  if (!price) throw new Error(`no price for ${model}; add it to CLAUDE_PRICING before spending on it`);
  return price;
}

// Dollars for one call from its reported usage. Cache writes bill at 1.25x input, cache reads at 0.1x.
export function claudeUsd({ model, inputTokens = 0, outputTokens = 0, cacheWriteTokens = 0, cacheReadTokens = 0 }) {
  const price = claudePrice(model);
  const micro = inputTokens * price.input + outputTokens * price.output + cacheWriteTokens * price.input * 1.25 + cacheReadTokens * price.input * 0.1;
  return Number((micro / 1e6).toFixed(6));
}

// An upper bound for a set of calls, rounded up to the cent, for reserving against the cap.
export function estimateClaudeUsd(calls) {
  const micro = calls.reduce((sum, call) => {
    const price = claudePrice(call.model);
    return sum + call.inputTokens * price.input + call.outputTokens * price.output;
  }, 0);
  return roundUpCents(micro / 1e6);
}

// Reserved and completed entries count at their actual cost when known, else their estimate. A failed
// entry counts only what it actually billed, such as the calls that returned before a later one failed.
export function ledgerTotals(ledger) {
  const entries = ledger.entries ?? [];
  const counted = entries.filter((entry) => COUNTED.has(entry.status));
  const billedFailures = entries.filter((entry) => entry.status === "failed" && entry.actual_usd > 0);
  const committed = counted.reduce((sum, entry) => sum + (entry.actual_usd ?? entry.estimate_usd), 0) + billedFailures.reduce((sum, entry) => sum + entry.actual_usd, 0);
  return { cap: ledger.cap_usd, committed: round(committed), remaining: round(ledger.cap_usd - committed), entries: counted.length + billedFailures.length };
}

export function reserveSpend(ledger, entry) {
  if (!(entry.estimate_usd > 0)) throw new Error("estimate_usd must be positive");
  const totals = ledgerTotals(ledger);
  if (totals.committed + entry.estimate_usd > ledger.cap_usd + 1e-9) {
    throw new Error(`spend cap: $${entry.estimate_usd.toFixed(2)} would exceed the remaining $${totals.remaining.toFixed(2)} of the $${ledger.cap_usd} cap`);
  }
  if ((ledger.entries ?? []).some((existing) => existing.id === entry.id)) throw new Error(`ledger entry ${entry.id} already exists`);
  const record = {
    id: entry.id,
    at: entry.at ?? new Date().toISOString(),
    model: entry.model,
    purpose: entry.purpose,
    units: entry.units ?? {},
    estimate_usd: entry.estimate_usd,
    actual_usd: null,
    request_id: null,
    status: "reserved"
  };
  return { ...ledger, entries: [...(ledger.entries ?? []), record] };
}

export function settleSpend(ledger, id, { status, requestId = null, actualUsd = null }) {
  if (!["completed", "failed"].includes(status)) throw new Error("status must be completed or failed");
  let found = false;
  const entries = (ledger.entries ?? []).map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return { ...entry, status, request_id: requestId, actual_usd: actualUsd };
  });
  if (!found) throw new Error(`no ledger entry ${id}`);
  return { ...ledger, entries };
}

export function validateLedger(ledger) {
  const errors = [];
  if (!(ledger.cap_usd > 0)) errors.push("cap_usd must be positive");
  const ids = new Set();
  for (const entry of ledger.entries ?? []) {
    if (ids.has(entry.id)) errors.push(`duplicate ledger entry ${entry.id}`);
    ids.add(entry.id);
    if (!STATUSES.has(entry.status)) errors.push(`${entry.id}: bad status ${entry.status}`);
    if (!(entry.estimate_usd > 0)) errors.push(`${entry.id}: estimate_usd must be positive`);
  }
  const totals = ledgerTotals(ledger);
  if (totals.committed > ledger.cap_usd + 1e-9) errors.push(`committed $${totals.committed} exceeds the $${ledger.cap_usd} cap`);
  return { valid: errors.length === 0, errors, totals };
}

export async function loadLedger(root) {
  return JSON.parse(await readFile(join(root, LEDGER_PATH), "utf8"));
}

export async function saveLedger(root, ledger) {
  await writeFile(join(root, LEDGER_PATH), `${JSON.stringify(ledger, null, 2)}\n`);
}
