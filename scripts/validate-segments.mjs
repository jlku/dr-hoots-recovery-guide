import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSegmentBundle, segmentNarrationSeconds, validateSegments } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const bundle = await loadSegmentBundle(repositoryRoot);
  const result = validateSegments(bundle);
  const errors = [...result.errors];
  for (const segment of bundle.segments.segments) {
    let seconds = "n/a";
    try {
      seconds = `${segmentNarrationSeconds(segment, bundle.records, "en").toFixed(1)}s`;
    } catch {
      seconds = "unbound";
    }
    console.log(`${String(segment.number).padStart(2, "0")}  ${segment.id.padEnd(26)} ${seconds}`);
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    process.exit(1);
  }
  const sentenceCount = bundle.canonical.modules.reduce((sum, module) => sum + module.canonical_sentences.length, 0);
  console.log(`segments valid: ${bundle.segments.segments.length} segments cover ${sentenceCount} canonical sentences`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
