// scripts/review-anatomy.mjs
// Caption-blind review of one image through the Claude API: three observers who see only the image,
// a coder who sees only the contract and their words, and a verdict computed in code. Writes a
// receipt, keeps the reviews index and the manifest in step, and records spend in the ledger.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_CODINGS, DEFAULT_MODEL } from "./lib/evaluator.mjs";
import { reviewAndRecord } from "./lib/review-runner.mjs";

const USAGE = `Review an image through the Claude API.

  npm run review -- --record <manifest record id> [--apply]
  npm run review -- --diagram <diagram id>
  npm run review -- --recode <receipt path> --out <path>
  npm run review -- --record <record id> --as <asset contract id> --out <path>

Options:
  --dry-run   print the requests and the most the review can cost; no call, no spend
  --apply     accept a candidate record when its review passes
  --force     replace an existing receipt
  --out       write the receipt somewhere other than content/reviews/anatomy/<id>.json
  --as        judge a record's image against another asset's contract (a negative control)
  --codings   how many times the coder codes the answers (default ${DEFAULT_CODINGS}); a picture passes only when every coding passes
  --model     default ${DEFAULT_MODEL}

Needs ANTHROPIC_API_KEY in the ignored .env.local. Spend counts against the ledger's cap.`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (flag) => args.includes(flag);
if (has("--help") || !(value("--record") || value("--diagram") || value("--recode"))) {
  console.log(USAGE);
  process.exit(has("--help") ? 0 : 1);
}

try {
  const outcome = await reviewAndRecord({
    root,
    selection: { record: value("--record"), diagram: value("--diagram"), recode: value("--recode"), as: value("--as") },
    out: value("--out"),
    force: has("--force"),
    apply: has("--apply"),
    dryRun: has("--dry-run"),
    model: value("--model") ?? DEFAULT_MODEL,
    codings: value("--codings") ? Number(value("--codings")) : DEFAULT_CODINGS,
    log: (line) => console.log(line)
  });
  if (outcome.dryRun) {
    console.log(JSON.stringify(outcome.preview, null, 2));
    console.log(`dry run: no request, no spend. At most $${outcome.preview.cost_bound_usd.toFixed(2)}; $${outcome.preview.ledger_remaining_usd.toFixed(2)} left under the cap.`);
  } else {
    const { adjudication } = outcome.receipt;
    console.log(`verdict: ${outcome.verdict}${adjudication.rule === "strict" ? "" : ` (strict rule: ${outcome.verdict_strict})`}${adjudication.unsettled ? " - the codings disagreed" : ""}`);
    console.log(adjudication.reason);
    if (adjudication.citation_checks.length) console.log(`citation checks: ${adjudication.citation_checks.length}, see the receipt`);
    console.log(`cost: $${outcome.cost.toFixed(4)}. Receipt: ${outcome.path}`);
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
