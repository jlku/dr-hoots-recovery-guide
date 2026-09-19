// scripts/validate-spend.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLedger, validateLedger } from "./lib/spend-ledger.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledger = await loadLedger(root);
const result = validateLedger(ledger);
for (const error of result.errors) console.error(`error: ${error}`);
if (!result.valid) process.exit(1);
console.log(`spend ledger valid: $${result.totals.committed.toFixed(2)} committed of $${result.totals.cap} across ${result.totals.entries} entries; $${result.totals.remaining.toFixed(2)} remaining`);
