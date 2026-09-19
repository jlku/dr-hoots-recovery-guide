// Emits the packet a reviewer reads:
//   node scripts/review-packet.mjs es|zh [--out packet.json]
//   node scripts/review-packet.mjs song --evidence <dir> [--out packet.json]
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSongPacket } from "./lib/song-review.mjs";
import { buildPacket } from "./lib/translation-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flag = (name) => (process.argv.indexOf(name) > 0 ? process.argv[process.argv.indexOf(name) + 1] : null);
const [reviewer] = process.argv.slice(2).filter((arg, index, args) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
let packet;
let summary;
if (reviewer === "song") {
  const evidenceDir = resolve(flag("--evidence") ?? "");
  const evidence = JSON.parse(await readFile(join(evidenceDir, "facts.json"), "utf8"));
  packet = await buildSongPacket({ root, evidence, evidenceDir });
  summary = `${packet.rubric.checks.length} checks and ${packet.screenshots.length} screenshots for build ${packet.target.sha256.slice(0, 16)}`;
} else {
  packet = await buildPacket({ root, reviewer });
  summary = `${packet.items.length} items for ${packet.target.file} at ${packet.target.sha256.slice(0, 16)}`;
}
const text = `${JSON.stringify(packet, null, 2)}\n`;
if (flag("--out")) {
  await writeFile(flag("--out"), text);
  console.log(`${flag("--out")}: ${summary}`);
} else {
  process.stdout.write(text);
}
