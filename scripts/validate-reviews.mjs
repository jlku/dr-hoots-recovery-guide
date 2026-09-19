// scripts/validate-reviews.mjs
// Every review receipt must be listed, carry three observers, and record a verdict that follows
// from its own findings under the adjudication rules in scripts/lib/adjudication.mjs.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateReviews } from "./lib/adjudication.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await validateReviews(root);
for (const error of result.errors) console.error(`error: ${error}`);
if (!result.valid) process.exit(1);
const { receipts, pass, fail, strict_kept: strictKept } = result.summary;
console.log(`reviews valid: ${receipts} receipts, ${pass} pass, ${fail} fail, ${strictKept} keep a strict verdict beside the instruction-picture verdict`);
