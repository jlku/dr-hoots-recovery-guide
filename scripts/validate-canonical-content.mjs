import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const contentPath = new URL("../content/canonical/ci-phase0-v0.1.0.json", import.meta.url);
const content = JSON.parse(await readFile(contentPath, "utf8"));
const printOnly = process.argv.includes("--print");
const errors = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashClaims(claims) {
  return sha256(claims.map(({ id, claim }) => `${id}\t${claim}`).join("\n"));
}

function hashSentences(sentences) {
  return sha256(sentences.map(({ id, text }) => `${id}\t${text}`).join("\n"));
}

function countSyllables(rawWord) {
  const word = rawWord.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  if (word.length <= 3) return 1;
  const trimmed = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/u, "").replace(/^y/u, "");
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/gu) || []).length);
}

function gradeLevel(text) {
  const sentences = Math.max(1, (text.match(/[.!?]+(?=\s|$)/gu) || []).length);
  const words = text.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/gu) || [];
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  return Number((0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59).toFixed(1));
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

const sourceClaims = new Map();
const sourceResults = {};
for (const source of content.sources) {
  const computedHash = hashClaims(source.claims);
  sourceResults[source.id] = computedHash;
  assert(source.claim_snapshot_sha256 === computedHash, `${source.id}: claim snapshot hash mismatch`);
  // A practice protocol is the partner surgeon's own text in this repository, not a page on the web.
  // It carries the file instead of a URL, and stays in surgeon_review until the surgeon marks it up.
  if (source.kind === "practice_protocol") {
    assert(typeof source.file === "string" && existsSync(new URL(`../${source.file}`, import.meta.url)), `${source.id}: practice protocol file is missing`);
    assert(source.status === "surgeon_review", `${source.id}: a practice protocol stays in surgeon_review until the surgeon marks it up`);
    assert(!source.url, `${source.id}: a practice protocol has a file, not a URL`);
  } else {
    assert(source.url.startsWith("https://"), `${source.id}: source URL must use HTTPS`);
  }
  // Sources added after the first snapshot carry their own, later retrieval date.
  assert(/^\d{4}-\d{2}-\d{2}$/.test(source.retrieved_at) && source.retrieved_at >= content.artifact.source_retrieved_at, `${source.id}: retrieval date must be on or after the artifact's first snapshot`);
  for (const claim of source.claims) {
    assert(!sourceClaims.has(claim.id), `${claim.id}: duplicate source claim ID`);
    sourceClaims.set(claim.id, claim);
  }
}

const moduleResults = {};
const moduleIds = content.modules.map((module) => module.id);
assert(JSON.stringify(moduleIds) === JSON.stringify(content.artifact.canonical_order), "Module order differs from canonical_order");
assert(content.artifact.status === "unverified_draft", "Artifact must remain unverified_draft");
assert(content.artifact.patient_use === false, "Artifact must not be marked for patient use");
assert(content.artifact.notice === "UNVERIFIED — NOT FOR PATIENT USE", "Required draft notice is missing");

for (const module of content.modules) {
  const text = module.canonical_sentences.map(({ text: sentence }) => sentence).join(" ");
  const computedHash = hashSentences(module.canonical_sentences);
  const computedGrade = gradeLevel(text);
  moduleResults[module.id] = { content_sha256: computedHash, grade: computedGrade };
  assert(module.content_sha256 === computedHash, `${module.id}: content hash mismatch`);
  assert(module.readability.grade === computedGrade, `${module.id}: readability grade mismatch`);
  assert(computedGrade <= module.readability.target_max, `${module.id}: grade ${computedGrade} exceeds target ${module.readability.target_max}`);
  // surgeon_review is stricter than a draft: medication wording must be reviewed by the partner surgeon.
  assert(["unverified_draft", "surgeon_review"].includes(module.status), `${module.id}: status must be unverified_draft or surgeon_review`);
  if (module.status === "surgeon_review") assert(module.review.partner_surgeon === "required", `${module.id}: surgeon_review needs the partner surgeon marked required`);
  assert(module.review.patient_ready === false, `${module.id}: patient_ready must be false`);
  for (const sentence of module.canonical_sentences) {
    assert(sentence.source_claim_ids.length > 0, `${sentence.id}: missing source claims`);
    for (const claimId of sentence.source_claim_ids) {
      assert(sourceClaims.has(claimId), `${sentence.id}: unknown source claim ${claimId}`);
    }
  }
}

const wound = content.modules.find(({ id }) => id === "ci/wound-care");
const call = content.modules.find(({ id }) => id === "ci/when-to-call");
const activation = content.modules.find(({ id }) => id === "ci/activation");
assert(wound && call && activation, "All three canonical modules are required");

if (wound) {
  const woundText = wound.canonical_sentences.map(({ text }) => text).join(" ").toLowerCase();
  assert(woundText.includes("if there is tape"), "Wound module: tape branch is missing");
  assert(woundText.includes("if there is no tape"), "Wound module: no-tape branch is missing");
  assert(woundText.includes("equal parts hydrogen peroxide and distilled water"), "Wound module: 50/50 cleaning mixture drifted");
  assert(woundText.includes("twice a day"), "Wound module: cleaning frequency drifted");
}

if (call) {
  const threshold = call.structured_values.find(({ field }) => field === "fever_threshold");
  assert(threshold?.operator === ">" && threshold?.value === 101.5 && threshold?.unit === "degrees Fahrenheit", "When-to-call module: fever threshold drifted");
  const redness = call.structured_values.find(({ field }) => field === "redness_improvement_window");
  assert(redness?.logic === "red AND swollen AND not improving AND painful to touch", "When-to-call module: redness logic drifted");
}

if (activation) {
  const timing = activation.structured_values.find(({ field }) => field === "activation_timing");
  assert(timing?.value === null && timing?.status === "blocked_conflicting_official_sources", "Activation module: unresolved timing must remain blocked");
  const activationText = activation.canonical_sentences.map(({ text }) => text).join(" ");
  assert(!/\b(?:\d+|one|two|three|four|five|six)\s+(?:day|days|week|weeks|month|months)\b/iu.test(activationText), "Activation module: exact timing was introduced despite source conflict");
}

if (printOnly) {
  console.log(JSON.stringify({ sources: sourceResults, modules: moduleResults }, null, 2));
  process.exit(0);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Canonical content valid: ${content.modules.length} modules, ${sourceClaims.size} source claims.`);
