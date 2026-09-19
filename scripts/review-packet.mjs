// Emits the packet a language reviewer reads: node scripts/review-packet.mjs es [--out packet.json]
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPacket } from "./lib/translation-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [reviewer] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const outIndex = process.argv.indexOf("--out");
const packet = await buildPacket({ root, reviewer });
const text = `${JSON.stringify(packet, null, 2)}\n`;
if (outIndex > 0) {
  await writeFile(process.argv[outIndex + 1], text);
  console.log(`${process.argv[outIndex + 1]}: ${packet.items.length} items for ${packet.target.file} at ${packet.target.sha256.slice(0, 16)}`);
} else {
  process.stdout.write(text);
}
