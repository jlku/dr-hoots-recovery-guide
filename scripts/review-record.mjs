// Validates a language reviewer's receipt against the current pack and stores it, never replacing
// one, under content/reviews/<reviewer>/: node scripts/review-record.mjs receipt.json
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPacket, receiptPath, validateReceipt } from "./lib/translation-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const receipt = JSON.parse(await readFile(process.argv[2], "utf8"));
const packet = await buildPacket({ root, reviewer: receipt.reviewer });
const errors = validateReceipt(receipt, packet);
if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}
const path = receiptPath(receipt.reviewer, receipt.target.sha256);
const exists = await access(join(root, path)).then(() => true, () => false);
if (exists) {
  console.error(`error: ${path} already holds the receipt for this pack; receipts are never replaced`);
  process.exit(1);
}
await mkdir(dirname(join(root, path)), { recursive: true });
await writeFile(join(root, path), `${JSON.stringify(receipt, null, 2)}\n`);
const failing = receipt.items.filter((item) => item.verdict === "fail").map((item) => item.id);
console.log(`${path}: ${receipt.verdict}${failing.length ? ` (${failing.length} items fail: ${failing.join(", ")})` : ""}`);
