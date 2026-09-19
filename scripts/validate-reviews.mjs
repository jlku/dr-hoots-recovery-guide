// scripts/validate-reviews.mjs
// Every review receipt must be listed, carry three observers, and record a verdict that follows
// from its own findings under the adjudication rules in scripts/lib/adjudication.mjs.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REVIEWS_INDEX, validateReviews } from "./lib/adjudication.mjs";
import { buildReviewsIndex } from "./lib/reviews-index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await validateReviews(root);
// The badges must describe what the guide serves now.
const committed = await readFile(join(root, REVIEWS_INDEX), "utf8");
if (committed !== `${JSON.stringify(await buildReviewsIndex(root), null, 2)}\n`) {
  result.valid = false;
  result.errors.push(`${REVIEWS_INDEX} is stale; run npm run reviews:index`);
}
for (const error of result.errors) console.error(`error: ${error}`);
if (!result.valid) process.exit(1);
const { receipts, pass, fail, strict_kept: strictKept, translations, song } = result.summary;
console.log(`reviews valid: ${receipts} receipts, ${pass} pass, ${fail} fail, ${strictKept} keep a strict verdict beside the instruction-picture verdict; ${translations} language review receipts; ${song} Song review receipts`);
