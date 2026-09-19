// Validates a language reviewer's receipt against the current pack and stores it in the pack's next
// free panel slot, never replacing one, under content/reviews/<reviewer>/:
// node scripts/review-record.mjs receipt.json
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PANEL_SIZE, buildPacket, panelReceiptPaths, validateReceipt } from "./lib/translation-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const receipt = JSON.parse(await readFile(process.argv[2], "utf8"));
const packet = await buildPacket({ root, reviewer: receipt.reviewer });
const errors = validateReceipt(receipt, packet);
if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}
const slots = panelReceiptPaths(receipt.reviewer, receipt.target.sha256);
let path = null;
for (const slot of slots) {
  if (!(await access(join(root, slot)).then(() => true, () => false))) {
    path = slot;
    break;
  }
}
if (!path) {
  console.error(`error: all ${PANEL_SIZE} receipts for this pack are recorded; receipts are never replaced`);
  process.exit(1);
}
await mkdir(dirname(join(root, path)), { recursive: true });
await writeFile(join(root, path), `${JSON.stringify(receipt, null, 2)}\n`);
const failing = receipt.items.filter((item) => item.verdict === "fail").map((item) => item.id);
console.log(`${path}: reviewer ${slots.indexOf(path) + 1} of ${PANEL_SIZE}, ${receipt.verdict}${failing.length ? ` (${failing.length} items fail: ${failing.join(", ")})` : ""}`);
