// scripts/validate-instructions.mjs
// Fails when an instruction sentence has no claim, a placeholder has no open question, or a
// claim points at a frame that does not speak its sentences.
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadFrameManifest } from "./lib/frames.mjs";
import { loadInstructions, loadQuestions, validateInstructions } from "./lib/instructions.mjs";
import { loadSegmentBundle } from "./lib/segments.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await loadSegmentBundle(root);
const canonical = JSON.parse(await readFile(join(root, "content/canonical/ci-phase0-v0.1.0.json"), "utf8"));
const result = await validateInstructions({
  root,
  instructions: await loadInstructions(root),
  canonical,
  segments: bundle.segments,
  frames: await loadFrameManifest(root),
  questions: await loadQuestions(root)
});
for (const error of result.errors) console.error(`error: ${error}`);
if (!result.valid) process.exit(1);
const { placeholder, text, illustrated, verified } = result.summary;
console.log(`instructions valid: ${placeholder} placeholder, ${text} text, ${illustrated} illustrated, ${verified} verified; every instruction sentence is claimed or excused`);
