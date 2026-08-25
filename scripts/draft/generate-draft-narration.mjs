// Draft-preview narration for the full-length guide previews (see docs/DRAFT_DIRECTION.md).
// Writes to assets/audio/draft/ with its own manifest; never touches assets/audio/manifest.json
// or any .production state. Same voice and settings as the existing provisional narration.
import { fal } from "@fal-ai/client";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const canonicalPath = path.join(projectRoot, "content", "canonical", "ci-phase0-v0.1.0.json");
const outputDir = path.join(projectRoot, "assets", "audio", "draft");
const manifestPath = path.join(outputDir, "manifest.json");
const force = process.argv.includes("--force");

if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing. Run with --env-file=.env.local.");

const canonical = JSON.parse(await readFile(canonicalPath, "utf8"));
const sentencesById = new Map(
  canonical.modules.flatMap((module) => module.canonical_sentences.map((item) => [item.id, item.text]))
);
const joined = (...ids) => ids.map((id) => {
  const text = sentencesById.get(id);
  if (!text) throw new Error(`Unknown canonical sentence id: ${id}`);
  return text;
}).join(" ");

const tracks = [
  { id: "wound-dressing", sentenceIds: ["wc.01", "wc.02"], text: joined("wc.01", "wc.02") },
  { id: "wound-tape", sentenceIds: ["wc.03", "wc.04"], text: joined("wc.03", "wc.04") },
  { id: "wound-no-tape", sentenceIds: ["wc.05", "wc.06", "wc.07"], text: joined("wc.05", "wc.06", "wc.07") },
  { id: "wound-shower", sentenceIds: ["wc.08"], text: joined("wc.08") },
  { id: "wound-follow-up", sentenceIds: ["wc.09", "wc.10"], text: joined("wc.09", "wc.10") },
  { id: "call-redness", sentenceIds: ["call.01", "call.01a", "call.01b", "call.01c"], text: joined("call.01", "call.01a", "call.01b", "call.01c") },
  { id: "call-fever", sentenceIds: ["call.02"], text: joined("call.02") },
  { id: "call-fluid", sentenceIds: ["call.03"], text: joined("call.03") },
  { id: "call-neuro", sentenceIds: ["call.04"], text: joined("call.04") },
  { id: "call-concerns", sentenceIds: ["call.05"], text: joined("call.05") },
  { id: "call-contact", sentenceIds: ["call.06", "call.07", "call.07a", "call.08"], text: joined("call.06", "call.07", "call.07a", "call.08") },
  // Medium copy only: no clinical proposition, timing, outcome, or advice.
  { id: "outro", sentenceIds: [], text: "That is the full guide. You can replay any part, or read everything again at your own pace." },

  // Non-clinical category bumpers for full-body host appearances.
  { id: "part1-intro", sentenceIds: [], text: "First, let’s go over how to care for the surgery site." },
  { id: "part2-intro", sentenceIds: [], text: "Next, let’s look at when to call your surgeon or clinic." },

  // ---- v1.1 consolidated script (approved by John 2026-08-23; draft adaptations
  // pending the surgical-content gate — see docs/plans/2026-08-23-v1-script-and-host-proposal.md).
  { id: "welcome-ci", sentenceIds: [], text: "Hi, I’m Dr. Hoots. Here’s what to expect after your cochlear implant surgery." },
  { id: "wound-day2", sentenceIds: ["wc.01", "wc.02"], text: "Two days after surgery, remove the head bandage. Then check: is there tape over the incision behind your ear?" },
  { id: "wound-paths", sentenceIds: ["wc.03", "wc.04", "wc.05", "wc.06", "wc.07"], text: "If there is tape — keep the area dry until three days after surgery, and do not clean it before then. If there is no tape — clean the edges gently twice a day with equal parts hydrogen peroxide and distilled water, then apply an antibiotic ointment such as bacitracin." },
  { id: "wound-milestones", sentenceIds: ["wc.08", "wc.09", "wc.10"], text: "Three days after surgery, you may shower and wash your hair. Your wound check and ear exam are about two weeks after surgery — the stitches dissolve on their own." },
  { id: "call-three-signs", sentenceIds: ["call.01", "call.01a", "call.01b", "call.01c"], text: "Call your surgeon or clinic if all three of these are true: the incision is red and swollen, it is not getting better over one to two days, and it hurts when touched." },
  { id: "call-any", sentenceIds: ["call.02", "call.03", "call.04", "call.05"], text: "Also call for any of these: a fever above 101.5 degrees Fahrenheit; swelling, or fluid building up, behind your ear; a headache, light sensitivity, or excessive lethargy; or any question or concern about you or your child." },
  { id: "call-numbers", sentenceIds: ["call.06", "call.07", "call.07a", "call.08"], text: "For routine questions, leave a message on the nursing line: 415-353-2148. You should get a call back within 12 hours — if no one calls, call again. For an emergency, call 415-476-1000 and ask for the Otolaryngology resident on call." },
  { id: "outro-v2", sentenceIds: [], text: "That’s the guide. Replay any part, or read it at your own pace." }
];

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
  if (!force && (await exists(destination)) && existingRecord?.text === track.text) {
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
      seed: 90001 + index,
      output_format: settings.outputFormat
    }
  });

  const audioUrl = result.data.audio?.url;
  if (!audioUrl) throw new Error(`FAL returned no audio URL for ${track.id}.`);
  await download(audioUrl, destination);
  records = records.filter((record) => record.id !== track.id);
  records.push({
    id: track.id,
    file: `assets/audio/draft/${fileName}`,
    text: track.text,
    canonicalSentenceIds: track.sentenceIds,
    model: settings.model,
    voice: settings.voice,
    stability: settings.stability,
    similarityBoost: settings.similarityBoost,
    speed: settings.speed,
    outputFormat: settings.outputFormat,
    seed: 90001 + index,
    requestId: result.requestId,
    timestamps: result.data.timestamps ?? [],
    status: "draft_preview_only"
  });
  console.log(`Saved ${fileName}.`);
}

await writeFile(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`);
console.log(`Wrote ${path.relative(projectRoot, manifestPath)}.`);
