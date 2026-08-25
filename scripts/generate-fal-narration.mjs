import { fal } from "@fal-ai/client";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalPath = path.join(projectRoot, "content", "canonical", "ci-phase0-v0.1.0.json");
const adaptationPath = path.join(projectRoot, "content", "adaptations", "activation-programming-v0.1.0.json");
const outputDir = path.join(projectRoot, "assets", "audio");
const manifestPath = path.join(outputDir, "manifest.json");
const force = process.argv.includes("--force");

if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing. Add it to .env.local before generating narration.");

const canonical = JSON.parse(await readFile(canonicalPath, "utf8"));
const adaptation = JSON.parse(await readFile(adaptationPath, "utf8"));
const activation = canonical.modules.find((module) => module.id === "ci/activation");
const sentence = (id) => activation.canonical_sentences.find((item) => item.id === id).text;

const tracks = [
  {
    id: "linear-welcome",
    text: "Hi, I’m Dr. Hoots. I’ll guide you through what happens after your surgery site heals.",
    format: "linear_video",
    sentenceIds: ["act.01"]
  },
  {
    id: "chaptered-welcome",
    text: "Hi, I’m Dr. Hoots. Here’s what to expect after your surgery site heals.",
    format: "chaptered_video",
    sentenceIds: ["act.01"]
  },
  { id: "healing", text: sentence("act.01"), format: "shared_video", sentenceIds: ["act.01"] },
  { id: "linear-programming", text: adaptation.formats.linear_video.blocks.map((block) => block.text).join(" "), format: "linear_video", sentenceIds: adaptation.canonical_sentence_ids },
  { id: "chaptered-programming", text: adaptation.formats.chaptered_video.blocks.map((block) => block.text).join(" "), format: "chaptered_video", sentenceIds: adaptation.canonical_sentence_ids },
  { id: "follow-up", text: [sentence("act.04"), sentence("act.05")].join(" "), format: "shared_video", sentenceIds: ["act.04", "act.05"] }
];

const trackMetadata = (track) => ({
  artifactId: canonical.artifact.id,
  artifactVersion: canonical.artifact.version,
  moduleId: activation.id,
  moduleVersion: activation.version,
  contentSha256: activation.content_sha256,
  format: track.format,
  canonicalSentenceIds: track.sentenceIds,
  adaptationId: track.id.includes("programming") ? adaptation.adaptation_id : null,
  adaptationVersion: track.id.includes("programming") ? adaptation.adaptation_version : null
});

const settings = {
  model: "fal-ai/elevenlabs/tts/eleven-v3",
  voice: "George",
  stability: 0.68,
  similarityBoost: 0.78,
  speed: 0.92,
  outputFormat: "mp3_44100_128"
};

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to download generated narration: ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

await mkdir(outputDir, { recursive: true });
let records = [];
if (await exists(manifestPath)) records = JSON.parse(await readFile(manifestPath, "utf8")).records ?? [];

for (const [index, track] of tracks.entries()) {
  const fileName = `${track.id}.mp3`;
  const destination = path.join(outputDir, fileName);
  const existingRecord = records.find((record) => record.id === track.id);
  if (!force && await exists(destination) && existingRecord?.text === track.text) {
    records = records.filter((record) => record.id !== track.id);
    records.push({ ...existingRecord, ...trackMetadata(track) });
    console.log(`Keeping existing ${fileName} (use --force to regenerate).`);
    continue;
  }

  console.log(`Generating ${track.id} narration…`);
  const result = await fal.subscribe(settings.model, {
    input: {
      text: track.text,
      voice: settings.voice,
      stability: settings.stability,
      similarity_boost: settings.similarityBoost,
      speed: settings.speed,
      language_code: "en",
      apply_text_normalization: "auto",
      timestamps: true,
      seed: 82500 + index,
      output_format: settings.outputFormat
    },
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_PROGRESS") {
        for (const log of update.logs ?? []) console.log(`  ${log.message}`);
      }
    }
  });

  const audioUrl = result.data.audio?.url;
  if (!audioUrl) throw new Error(`FAL returned no audio URL for ${track.id}.`);
  await download(audioUrl, destination);
  records = records.filter((record) => record.id !== track.id);
  records.push({
    id: track.id,
    file: `assets/audio/${fileName}`,
    text: track.text,
    model: settings.model,
    voice: settings.voice,
    stability: settings.stability,
    similarityBoost: settings.similarityBoost,
    speed: settings.speed,
    outputFormat: settings.outputFormat,
    seed: 82500 + index,
    requestId: result.requestId,
    timestamps: result.data.timestamps ?? [],
    ...trackMetadata(track),
    status: "provisional_private_prototype"
  });
  console.log(`Saved ${fileName}.`);
}

await writeFile(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`);
console.log(`Wrote ${path.relative(projectRoot, manifestPath)}.`);
