// scripts/validate-frames.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadFrameManifest, validateFrames } from "./lib/frames.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadSegmentBundle } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const bundle = await loadSegmentBundle(repositoryRoot);
  const frames = await loadFrameManifest(repositoryRoot);
  const labels = JSON.parse(await readFile(join(repositoryRoot, "content/translations/en/ci-phase0-v0.1.0.json"), "utf8")).labels;
  const result = await validateFrames({ frames, segments: bundle.segments, root: repositoryRoot, labels });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (!result.valid) {
    for (const error of result.errors) console.error(`error: ${error}`);
    process.exit(1);
  }
  console.log(`frames valid: ${Object.keys(frames.frames).length} frames cover every beat`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
