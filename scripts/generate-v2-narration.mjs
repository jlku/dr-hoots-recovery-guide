// Narration for a translated pack, one track per beat, through fal's ElevenLabs v3 with the language
// code set. Every request reserves its estimate in the ledger first and refuses past the cap.
//   node --env-file=.env.local scripts/generate-v2-narration.mjs --language es [--dry-run] [--force]
//   node --env-file=.env.local scripts/generate-v2-narration.mjs --language es --voice-test --out <dir>
import { fal } from "@fal-ai/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSegmentBundle } from "./lib/segments.mjs";
import { estimateNarrationUsd, loadLedger, reserveSpend, saveLedger, settleSpend } from "./lib/spend-ledger.mjs";
import { NARRATION_MODEL, beatRecordId, narratedBeats, narrationManifestPath, planNarration } from "./lib/v2-narration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const language = arg("--language");
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const voiceTest = process.argv.includes("--voice-test");
const voices = JSON.parse(await readFile(join(root, "assets/audio/v2/voices.json"), "utf8")).languages;
const settings = voices[language];
if (!settings) throw new Error(`--language must be one of ${Object.keys(voices).join(", ")}`);
const pack = JSON.parse(await readFile(join(root, `content/translations/${language}/ci-phase0-v0.1.0.json`), "utf8"));
const bundle = await loadSegmentBundle(root);

async function speak({ text, voice, seed, ledgerId, purpose }) {
  await saveLedger(root, reserveSpend(await loadLedger(root), { id: ledgerId, model: NARRATION_MODEL, purpose, units: { characters: text.length, language, voice }, estimate_usd: estimateNarrationUsd(text.length) }));
  let result;
  try {
    result = await fal.subscribe(NARRATION_MODEL, {
      input: { text, voice, stability: settings.stability, similarity_boost: settings.similarity_boost, speed: settings.speed, language_code: settings.language_code, apply_text_normalization: "auto", timestamps: true, seed, output_format: "mp3_44100_128" }
    });
  } catch (error) {
    await saveLedger(root, settleSpend(await loadLedger(root), ledgerId, { status: "failed" }));
    throw error;
  }
  // Billed once fal answers, so the entry settles before the download that could still fail.
  await saveLedger(root, settleSpend(await loadLedger(root), ledgerId, { status: "completed", requestId: result.requestId ?? null }));
  const url = result.data?.audio?.url;
  if (!url) throw new Error(`fal returned no audio for ${ledgerId}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), requestId: result.requestId ?? null, timestamps: result.data.timestamps ?? [] };
}

if (!dryRun && !process.env.FAL_KEY) throw new Error("FAL_KEY is missing; run with --env-file=.env.local");
if (!dryRun) fal.config({ credentials: process.env.FAL_KEY });
const stamp = new Date().toISOString();

if (voiceTest) {
  // One short line per candidate voice: the sentence with a phone number, so a listener hears digits too.
  const out = arg("--out");
  if (!dryRun && !out) throw new Error("--voice-test needs --out <dir>");
  const text = pack.sentences["call.06"];
  for (const [index, voice] of settings.candidates.entries()) {
    console.log(`${language} ${voice}: ${text.length} characters, about $${estimateNarrationUsd(text.length).toFixed(2)}`);
    if (dryRun) continue;
    const { bytes } = await speak({ text, voice, seed: settings.seed_base + 900 + index, ledgerId: `tts:${language}:voice-test:${voice}:${stamp}`, purpose: `voice test for ${language}: ${voice}` });
    await mkdir(out, { recursive: true });
    await writeFile(join(out, `voice-test-${language}-${voice}.mp3`), bytes);
    console.log(`  saved ${join(out, `voice-test-${language}-${voice}.mp3`)}`);
  }
  process.exit(0);
}

if (!settings.voice) throw new Error(`pick a voice for ${language} in assets/audio/v2/voices.json after the voice test`);
const manifestPath = narrationManifestPath(language);
const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8").catch(() => '{"records":[]}'));
const plan = planNarration({ segments: bundle.segments, pack, voice: settings, manifest });
const todo = plan.filter((item) => force || !item.keep);
console.log(`${language}: ${todo.length} of ${plan.length} beats to narrate with ${settings.voice}, about $${todo.reduce((sum, item) => sum + item.estimate_usd, 0).toFixed(2)}`);
if (dryRun) process.exit(0);
let records = manifest.records ?? [];
for (const [index, item] of plan.entries()) {
  if (!force && item.keep) continue;
  const seed = settings.seed_base + index;
  const { bytes, requestId, timestamps } = await speak({ text: item.text, voice: settings.voice, seed, ledgerId: `tts:${language}:${item.record_id}:${stamp}`, purpose: `${language} narration for ${item.beat_id}` });
  const file = `assets/audio/v2/${language}/beats/${item.record_id}.mp3`;
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), bytes);
  records = [...records.filter((record) => record.id !== item.record_id), {
    id: item.record_id, file, text: item.text, language, language_code: settings.language_code, canonicalSentenceIds: item.sentence_ids,
    model: NARRATION_MODEL, voice: settings.voice, stability: settings.stability, similarityBoost: settings.similarity_boost, speed: settings.speed,
    outputFormat: "mp3_44100_128", seed, requestId, timestamps, status: "draft_preview_only"
  }];
  await mkdir(dirname(join(root, manifestPath)), { recursive: true });
  await writeFile(join(root, manifestPath), `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`);
  console.log(`${item.record_id}: saved`);
}
// Bind every narrated beat to its record, so the language is complete or absent.
const segmentsPath = join(root, "content/segments/ci-phase0-v0.1.0.segments.json");
const segments = JSON.parse(await readFile(segmentsPath, "utf8"));
for (const beat of narratedBeats(segments)) beat.narration[language] = { manifest: manifestPath, record_id: beatRecordId(beat) };
await writeFile(segmentsPath, `${JSON.stringify(segments, null, 2)}\n`);
console.log(`bound ${language} narration on every beat`);
