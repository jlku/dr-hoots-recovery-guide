// scripts/validate-frames.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadFrameManifest, validateFrames } from "./lib/frames.mjs";
import { loadSegmentBundle } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const bundle = await loadSegmentBundle(repositoryRoot);
  const frames = await loadFrameManifest(repositoryRoot);
  const result = await validateFrames({ frames, segments: bundle.segments, root: repositoryRoot });
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
