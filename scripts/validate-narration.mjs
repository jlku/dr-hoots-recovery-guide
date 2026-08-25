import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = JSON.parse(await readFile(path.join(projectRoot, "content", "canonical", "ci-phase0-v0.1.0.json"), "utf8"));
const adaptation = JSON.parse(await readFile(path.join(projectRoot, "content", "adaptations", "activation-programming-v0.1.0.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(projectRoot, "assets", "audio", "manifest.json"), "utf8"));
const activation = canonical.modules.find((module) => module.id === "ci/activation");
const sentence = (id) => activation.canonical_sentences.find((item) => item.id === id).text;

const expected = new Map([
  ["linear-welcome", { text: "Hi, I’m Dr. Hoots. I’ll guide you through what happens after your surgery site heals.", format: "linear_video", ids: ["act.01"] }],
  ["chaptered-welcome", { text: "Hi, I’m Dr. Hoots. Here’s what to expect after your surgery site heals.", format: "chaptered_video", ids: ["act.01"] }],
  ["healing", { text: sentence("act.01"), format: "shared_video", ids: ["act.01"] }],
  ["linear-programming", { text: adaptation.formats.linear_video.blocks.map((block) => block.text).join(" "), format: "linear_video", ids: adaptation.canonical_sentence_ids }],
  ["chaptered-programming", { text: adaptation.formats.chaptered_video.blocks.map((block) => block.text).join(" "), format: "chaptered_video", ids: adaptation.canonical_sentence_ids }],
  ["follow-up", { text: [sentence("act.04"), sentence("act.05")].join(" "), format: "shared_video", ids: ["act.04", "act.05"] }]
]);

const errors = [];
const records = new Map(manifest.records.map((record) => [record.id, record]));
for (const id of records.keys()) if (!expected.has(id)) errors.push(`${id}: unexpected narration record`);

for (const [id, expectation] of expected) {
  const record = records.get(id);
  if (!record) {
    errors.push(`${id}: missing narration record`);
    continue;
  }
  if (record.text !== expectation.text) errors.push(`${id}: spoken copy does not match its source`);
  if (record.format !== expectation.format) errors.push(`${id}: format mapping is stale`);
  if (JSON.stringify(record.canonicalSentenceIds) !== JSON.stringify(expectation.ids)) errors.push(`${id}: canonical sentence mapping is stale`);
  if (record.artifactId !== canonical.artifact.id || record.artifactVersion !== canonical.artifact.version) errors.push(`${id}: artifact version is stale`);
  if (record.moduleId !== activation.id || record.moduleVersion !== activation.version || record.contentSha256 !== activation.content_sha256) errors.push(`${id}: module hash or version is stale`);
  const isAdapted = id.includes("programming");
  if (isAdapted && (record.adaptationId !== adaptation.adaptation_id || record.adaptationVersion !== adaptation.adaptation_version)) errors.push(`${id}: adaptation version is stale`);
  if (!isAdapted && (record.adaptationId !== null || record.adaptationVersion !== null)) errors.push(`${id}: unexpected adaptation mapping`);

  const characters = record.timestamps.flatMap((chunk) => chunk.characters.map((character, index) => ({
    character,
    start: chunk.character_start_times_seconds[index],
    end: chunk.character_end_times_seconds[index]
  })));
  if (characters.map(({ character }) => character).join("") !== record.text) errors.push(`${id}: timestamp characters do not match spoken copy`);
  if (characters.some(({ start, end }) => !Number.isFinite(start) || !Number.isFinite(end) || end < start)) errors.push(`${id}: invalid character timestamps`);

  const audioPath = path.join(projectRoot, record.file);
  try {
    await access(audioPath);
    if ((await stat(audioPath)).size < 1000) errors.push(`${id}: audio file is unexpectedly small`);
  } catch {
    errors.push(`${id}: audio file is missing`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Narration valid: ${expected.size} tracks, exact copy and character timestamps.`);
}
