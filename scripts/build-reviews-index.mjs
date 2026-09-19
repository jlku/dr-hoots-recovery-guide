// Rebuilds content/reviews/index.json, badges included: node scripts/build-reviews-index.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeReviewsIndex } from "./lib/reviews-index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { badges } = await writeReviewsIndex(root);
for (const [language, badge] of Object.entries(badges.translations)) console.log(`translation ${language}: ${badge.status}${badge.date ? ` ${badge.date}` : ""}`);
console.log(`song: ${badges.song.status}${badges.song.date ? ` ${badges.song.date}` : ""}${badges.song.target ? ` (build ${badges.song.target.slice(0, 16)})` : ""}`);
