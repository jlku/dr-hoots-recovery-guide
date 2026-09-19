// Validates a reviewer's receipt against what it reviewed and stores it in the next free panel slot,
// never replacing one, under content/reviews/<reviewer>/:
//   node scripts/review-record.mjs receipt.json                      a language reviewer (es, zh)
//   node scripts/review-record.mjs receipt.json --evidence <dir>     the simulated Song reviewer
// A Song receipt is stored with the measured facts it was judged against.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSongPacket, songPanelPaths, validateSongReceipt } from "./lib/song-review.mjs";
import { PANEL_SIZE, buildPacket, panelReceiptPaths, validateReceipt } from "./lib/translation-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const receipt = JSON.parse(await readFile(process.argv[2], "utf8"));
const evidenceIndex = process.argv.indexOf("--evidence");
let errors;
let slots;
let stored = receipt;
let failing;
if (receipt.reviewer === "song") {
  if (evidenceIndex < 0) throw new Error("a Song receipt needs --evidence <dir>, the evidence it was judged against");
  const evidenceDir = resolve(process.argv[evidenceIndex + 1]);
  const evidence = JSON.parse(await readFile(join(evidenceDir, "facts.json"), "utf8"));
  const packet = await buildSongPacket({ root, evidence, evidenceDir });
  errors = validateSongReceipt(receipt, packet);
  slots = songPanelPaths(packet.target.sha256);
  stored = { ...receipt, facts: packet.facts };
  failing = (receipt.checks ?? []).filter((check) => check.verdict === "fail").map((check) => check.id);
} else {
  const packet = await buildPacket({ root, reviewer: receipt.reviewer });
  errors = validateReceipt(receipt, packet);
  slots = panelReceiptPaths(receipt.reviewer, receipt.target.sha256);
  failing = (receipt.items ?? []).filter((item) => item.verdict === "fail").map((item) => item.id);
}
if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}
let path = null;
for (const slot of slots) {
  if (!(await access(join(root, slot)).then(() => true, () => false))) {
    path = slot;
    break;
  }
}
if (!path) {
  console.error(`error: all ${PANEL_SIZE} receipts for this target are recorded; receipts are never replaced`);
  process.exit(1);
}
await mkdir(dirname(join(root, path)), { recursive: true });
await writeFile(join(root, path), `${JSON.stringify(stored, null, 2)}\n`);
console.log(`${path}: reviewer ${slots.indexOf(path) + 1} of ${PANEL_SIZE}, ${receipt.verdict}${failing.length ? ` (${failing.length} fail: ${failing.join(", ")})` : ""}`);
