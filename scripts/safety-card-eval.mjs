#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildReviewPacket,
  evaluateCardStatus,
  loadEvaluationSpec,
  recordReceipt
} from "./lib/safety-card-eval.mjs";

const repositoryRoot = process.cwd();
const specPath = resolve(repositoryRoot, "evals/safety-cards/spec.json");
const receiptsRoot = resolve(repositoryRoot, "evals/safety-cards/receipts");
const spec = await loadEvaluationSpec(specPath);
const args = process.argv.slice(2);
const json = args.includes("--json");
const skipStale = args.includes("--skip-stale");
const positional = args.filter((argument) => !argument.startsWith("--"));
const [command, first, second] = positional;

function printStatus(status) {
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(`${status.card_id}\t${status.state}\t${status.next_action}`);
}

async function evaluateAllCards() {
  return Promise.all(
    spec.cards.map((card) => evaluateCardStatus({ repositoryRoot, receiptsRoot, spec, cardId: card.id }))
  );
}

if (command === "list") {
  (await evaluateAllCards()).forEach(printStatus);
} else if (command === "status") {
  if (first) {
    printStatus(await evaluateCardStatus({ repositoryRoot, receiptsRoot, spec, cardId: first }));
  } else {
    const statuses = await evaluateAllCards();
    if (json) console.log(JSON.stringify(statuses, null, 2));
    else statuses.forEach(printStatus);
  }
} else if (command === "packet") {
  if (!first || !second) throw new Error("usage: safety-card-eval packet <card-id> <observe|adjudicate|design|clinical>");
  const packet = await buildReviewPacket({ repositoryRoot, receiptsRoot, spec, cardId: first, phase: second });
  console.log(JSON.stringify(packet, null, 2));
} else if (command === "record") {
  if (!first) throw new Error("usage: safety-card-eval record <receipt.json>");
  const receipt = JSON.parse(await readFile(resolve(repositoryRoot, first), "utf8"));
  const stored = await recordReceipt({ repositoryRoot, receiptsRoot, spec, receipt });
  console.log(JSON.stringify({ stored: stored.path, idempotent: stored.idempotent }, null, 2));
} else if (command === "record-batch") {
  if (!first) throw new Error("usage: safety-card-eval record-batch <receipts.json>");
  const receipts = JSON.parse(await readFile(resolve(repositoryRoot, first), "utf8"));
  if (!Array.isArray(receipts) || receipts.length === 0) {
    throw new Error("record-batch input must be a non-empty JSON array of receipts");
  }
  const stored = [];
  const skipped = [];
  for (const receipt of receipts) {
    if (second && receipt.card_id !== second) {
      skipped.push({ receipt_id: receipt.receipt_id, reason: "card_filter" });
      continue;
    }
    if (skipStale) {
      const status = await evaluateCardStatus({
        repositoryRoot,
        receiptsRoot,
        spec,
        cardId: receipt.card_id
      });
      const stale =
        receipt.candidate_sha256 !== status.candidate_sha256 ||
        receipt.wrapped_sha256 !== status.wrapped_sha256;
      if (stale) {
        skipped.push({ receipt_id: receipt.receipt_id, reason: "stale_hash" });
        continue;
      }
    }
    const result = await recordReceipt({ repositoryRoot, receiptsRoot, spec, receipt });
    stored.push({ receipt_id: receipt.receipt_id, stored: result.path, idempotent: result.idempotent });
  }
  console.log(JSON.stringify({ count: stored.length, skipped_count: skipped.length, stored, skipped }, null, 2));
} else if (command === "clinical-bundle") {
  const cards = [];
  for (const card of spec.cards.filter((candidate) => candidate.clinical_review_required)) {
    const status = await evaluateCardStatus({ repositoryRoot, receiptsRoot, spec, cardId: card.id });
    if (status.state === "clinical_review") {
      cards.push(await buildReviewPacket({ repositoryRoot, receiptsRoot, spec, cardId: card.id, phase: "clinical" }));
    } else {
      cards.push({ card_id: card.id, state: status.state, next_action: status.next_action, patient_ready: status.patient_ready });
    }
  }
  console.log(JSON.stringify({
    bundle_version: "safety-card-clinical-bundle/v1",
    generated_at: new Date().toISOString(),
    patient_ready: false,
    canonical_source_path: spec.canonical_source_path,
    cards
  }, null, 2));
} else {
  console.error("usage: safety-card-eval <list|status|packet|record|record-batch|clinical-bundle> [arguments] [--json] [--skip-stale]");
  process.exitCode = 1;
}
