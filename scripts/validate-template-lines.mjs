// Checks the spine between the practice dot phrase and the spoken script:
//   node scripts/validate-template-lines.mjs
// Every canonical sentence belongs to one line of the block or is named in guide_only with a reason;
// every line the map claims exists in the draft and owns at least one sentence; and no sentence a
// patient's link can change speaks a number. That last rule is the one the walkthroughs kept catching by
// hand: narration said "about two weeks" while a link set any date.
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseProviderBlock } from "../guide/assets/provider.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));

export function templateLineErrors({ map, canonical, segments, draft }) {
const sentences = new Map(canonical.modules.flatMap((module) => module.canonical_sentences.map((sentence) => [sentence.id, sentence.text])));
const where = new Map();
for (const segment of segments.segments) {
  for (const beat of segment.beats) {
    for (const id of beat.sentence_ids ?? []) where.set(id, { chapter: segment.number, beat: beat.id });
  }
}
const draftKeys = new Set(parseProviderBlock(draft).other.map((entry) => entry.key).filter(Boolean));
const lines = { ...map.covered, ...map.fields };
const errors = [];

// A digit, or a number a narrator would read aloud. "one" is caught, "once" is not.
const NUMBER = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty)\b/i;

for (const [key, entry] of Object.entries(lines)) {
  const kind = key in map.covered ? "covered" : "field";
  if (!entry.sentences?.length) errors.push(`${kind} line "${key}" owns no canonical sentence`);
  if (kind === "covered" && !draftKeys.has(key)) errors.push(`covered line "${key}" is not a line of the draft dot phrase`);
  for (const id of entry.sentences ?? []) {
    if (!sentences.has(id)) errors.push(`line "${key}" claims ${id}, which is not a canonical sentence`);
    else if (!where.has(id)) errors.push(`line "${key}" claims ${id}, which plays in no beat`);
    else if (entry.numbers === "patient" && NUMBER.test(sentences.get(id))) {
      errors.push(`${id} speaks a number in a sentence the "${key}" field can change: "${sentences.get(id)}"`);
    }
  }
}

const owner = new Map();
for (const [key, entry] of Object.entries(lines)) {
  for (const id of entry.sentences ?? []) {
    if (owner.has(id)) errors.push(`${id} belongs to two lines: "${owner.get(id)}" and "${key}"`);
    owner.set(id, key);
  }
}
for (const id of sentences.keys()) {
  if (owner.has(id)) continue;
  if (!map.guide_only?.[id]) errors.push(`${id} belongs to no line of the block, and guide_only does not say why`);
}
for (const id of Object.keys(map.guide_only ?? {})) {
  if (!sentences.has(id)) errors.push(`guide_only names ${id}, which is not a canonical sentence`);
  else if (owner.has(id)) errors.push(`guide_only names ${id}, but the "${owner.get(id)}" line owns it`);
}
// A note_only label can share a line with others — "Surgery date: … Side: … Surgeon: …" is one line —
// so it is looked for as a label in the text, not as a parsed line key.
const labelled = (key) => new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*:`, "im").test(draft);
for (const key of map.note_only ?? []) {
  if (!labelled(key)) errors.push(`note_only names "${key}", which is not a label in the draft dot phrase`);
  if (key in lines) errors.push(`"${key}" is both note_only and a line that owns sentences`);
}

const counts = Object.entries(lines).map(([key, entry]) => `${key} ${entry.sentences.length}`).join(", ");
return { errors, summary: `${owner.size} of ${sentences.size} sentences owned by a line (${counts}); ${Object.keys(map.guide_only ?? {}).length} the guide says on its own` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { errors, summary } = templateLineErrors({
    map: await readJson("content/provider/template-lines.json"),
    canonical: await readJson("content/canonical/ci-phase0-v0.1.0.json"),
    segments: await readJson("content/segments/ci-phase0-v0.1.0.segments.json"),
    draft: await readFile(join(root, "content/provider/dot-phrase-draft.txt"), "utf8")
  });
  if (errors.length) {
    for (const error of errors) console.error(`  ${error}`);
    console.error(`template lines invalid: ${errors.length} problem${errors.length === 1 ? "" : "s"}`);
    process.exit(1);
  }
  console.log(`template lines valid: ${summary}`);
}
