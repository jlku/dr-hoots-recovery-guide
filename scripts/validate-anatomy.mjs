// scripts/validate-anatomy.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadContracts, loadManifest, validateAnatomy } from "./lib/anatomy.mjs";
import { loadFrameManifest } from "./lib/frames.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [contracts, manifest, frames] = await Promise.all([loadContracts(root), loadManifest(root), loadFrameManifest(root)]);
const result = await validateAnatomy({ contracts, manifest, frames, root });
for (const error of result.errors) console.error(`error: ${error}`);
if (!result.valid) process.exit(1);
const accepted = (manifest.records ?? []).filter((record) => record.status === "accepted").length;
console.log(`anatomy valid: ${contracts.assets.length} contracts, ${(manifest.records ?? []).length} records, ${accepted} accepted`);
