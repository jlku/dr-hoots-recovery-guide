import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { validateContentLock } from "./production-run.mjs";

const SELECTED_NARRATION_IDS = Object.freeze([
  "healing",
  "chaptered-programming",
  "follow-up"
]);
const EXPECTED_SCENE_IDS = Object.freeze([
  "scene/activation/healing",
  "scene/activation/programming",
  "scene/activation/follow-up"
]);
const EXCLUDED_NARRATION_IDS = new Set([
  "linear-welcome",
  "chaptered-welcome",
  "linear-programming"
]);
const EXPECTED_AUDIO_PATHS = Object.freeze({
  healing: "assets/audio/healing.mp3",
  "chaptered-programming": "assets/audio/chaptered-programming.mp3",
  "follow-up": "assets/audio/follow-up.mp3"
});
const REQUIRED_LOCKED_SOURCES = Object.freeze([
  "canonical_module",
  "activation_adaptation",
  "activation_production_contract"
]);
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;

const roundSeconds = (value) => Number(value.toFixed(6));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const bytes = (value) => (typeof value === "string" ? Buffer.from(value) : Buffer.from(value));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateLockedSources(contentLock, lockedSources) {
  validateContentLock(contentLock);
  const records = new Map(contentLock.inputs.map((input) => [input.id, input]));
  for (const id of REQUIRED_LOCKED_SOURCES) {
    const record = records.get(id);
    const source = lockedSources?.[id];
    assert(record && source, `locked source ${id} is missing`);
    assert(record.source_path === source.sourcePath, `locked source path drift for ${id}`);
    const sourceBytes = bytes(source.content);
    assert(record.sha256 === sha256(sourceBytes), `locked source hash drift for ${id}`);
    assert(record.byte_length === sourceBytes.byteLength, `locked source length drift for ${id}`);
  }
}

function expectedSceneText(scene, canonicalModule, adaptation) {
  const canonicalSentences = new Map(
    canonicalModule.canonical_sentences.map((sentence) => [sentence.id, sentence.text])
  );
  if (scene.narration_id === "chaptered-programming") {
    return adaptation.formats.chaptered_video.blocks.map((block) => block.text).join(" ");
  }
  return scene.canonical_sentence_ids.map((id) => canonicalSentences.get(id)).join(" ");
}

function flattenCharacters(record) {
  const characters = [];
  let previousEnd = -Infinity;
  for (const [chunkIndex, chunk] of record.timestamps.entries()) {
    const starts = chunk.character_start_times_seconds;
    const ends = chunk.character_end_times_seconds;
    assert(
      Array.isArray(chunk.characters) && Array.isArray(starts) && Array.isArray(ends),
      `${record.id}: timestamp chunk ${chunkIndex} is incomplete`
    );
    assert(
      chunk.characters.length === starts.length && starts.length === ends.length,
      `${record.id}: timestamp arrays have different lengths`
    );
    for (let index = 0; index < chunk.characters.length; index += 1) {
      const character = chunk.characters[index];
      const start = starts[index];
      const end = ends[index];
      assert(typeof character === "string", `${record.id}: timestamp character is invalid`);
      assert(
        Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start,
        `${record.id}: timestamp value is invalid`
      );
      assert(start + 1e-9 >= previousEnd, `${record.id}: timestamp characters overlap`);
      characters.push({ character, start, end });
      previousEnd = end;
    }
  }
  assert(characters.length > 0, `${record.id}: timestamp characters are missing`);
  assert(
    characters.map(({ character }) => character).join("") === record.text,
    `${record.id}: timestamp characters do not match spoken copy`
  );
  return characters;
}

function wordSpans(text) {
  return [...text.matchAll(/\S+/gu)].map((match) => ({
    text: match[0],
    startIndex: match.index,
    endIndex: match.index + match[0].length - 1
  }));
}

function sentenceSpans(text) {
  const spans = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (![".", "!", "?"].includes(text[index])) continue;
    let first = start;
    while (/\s/u.test(text[first] ?? "")) first += 1;
    if (first <= index) {
      spans.push({ text: text.slice(first, index + 1), startIndex: first, endIndex: index });
    }
    start = index + 1;
  }
  let first = start;
  while (/\s/u.test(text[first] ?? "")) first += 1;
  if (first < text.length) {
    spans.push({ text: text.slice(first), startIndex: first, endIndex: text.length - 1 });
  }
  return spans;
}

function timestamp(seconds, decimalSeparator) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return [hours, minutes, wholeSeconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":") + `${decimalSeparator}${String(remainder).padStart(3, "0")}`;
}

function buildVtt(cues) {
  const body = cues
    .map(
      (cue, index) =>
        `${index + 1}\n${timestamp(cue.global_start_seconds, ".")} --> ${timestamp(cue.global_end_seconds, ".")}\n${cue.text}`
    )
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

function buildSrt(cues) {
  return (
    cues
      .map(
        (cue, index) =>
          `${index + 1}\n${timestamp(cue.global_start_seconds, ",")} --> ${timestamp(cue.global_end_seconds, ",")}\n${cue.text}`
      )
      .join("\n\n") + "\n"
  );
}

function validateNarrationSelection({ production, canonical, adaptation, narrationManifest }) {
  assert(
    same(production.scene_order, EXPECTED_SCENE_IDS) &&
      same(
        production.scenes.map((scene) => scene.scene_id),
        EXPECTED_SCENE_IDS
      ),
    "activation radio scene order drifted"
  );
  const narrationIds = production.scenes.map((scene) => scene.narration_id);
  assert(
    same(narrationIds, SELECTED_NARRATION_IDS),
    `activation radio narration order must be ${SELECTED_NARRATION_IDS.join(", ")}; excluded tracks are forbidden`
  );
  assert(
    narrationIds.every((id) => !EXCLUDED_NARRATION_IDS.has(id)),
    "activation radio contains an excluded narration track"
  );

  const canonicalModule = canonical.modules.find((module) => module.id === production.module_id);
  assert(canonicalModule, "canonical activation module is missing");
  assert(production.patient_ready === false, "activation derivatives may never be patient-ready");
  const records = new Map(narrationManifest.records.map((record) => [record.id, record]));
  const selected = [];
  for (const scene of production.scenes) {
    const record = records.get(scene.narration_id);
    assert(record, `${scene.narration_id}: narration record is missing`);
    assert(
      record.file === EXPECTED_AUDIO_PATHS[record.id],
      `${record.id}: narration audio path is not allowlisted`
    );
    const expectedText = expectedSceneText(scene, canonicalModule, adaptation);
    assert(record.text === expectedText, `${record.id}: spoken copy does not match its source`);
    assert(
      same(record.canonicalSentenceIds, scene.canonical_sentence_ids),
      `${record.id}: canonical sentence mapping drifted`
    );
    assert(
      record.artifactId === canonical.artifact.id &&
        record.artifactVersion === canonical.artifact.version &&
        record.moduleId === canonicalModule.id &&
        record.moduleVersion === canonicalModule.version &&
        record.contentSha256 === canonicalModule.content_sha256,
      `${record.id}: narration content identity is stale`
    );
    if (record.id === "chaptered-programming") {
      assert(
        record.adaptationId === adaptation.adaptation_id &&
          record.adaptationVersion === adaptation.adaptation_version &&
          record.format === "chaptered_video",
        `${record.id}: narration adaptation identity is stale`
      );
    } else {
      assert(
        record.adaptationId === null && record.adaptationVersion === null,
        `${record.id}: unexpected narration adaptation`
      );
    }
    selected.push({ scene, record, characters: flattenCharacters(record) });
  }
  return { canonicalModule, selected };
}

function validateAudioSources(selected, audioSources) {
  return selected.map(({ scene, record, characters }) => {
    const source = audioSources?.[record.id];
    assert(source, `${record.id}: audio source is missing`);
    const duration = source.durationSeconds;
    const speechEnd = characters.at(-1).end;
    assert(Number.isFinite(duration) && duration > 0, `${record.id}: audio duration is invalid`);
    assert(duration + 0.001 >= speechEnd, `${record.id}: audio ends before its timestamp data`);
    return {
      scene,
      record,
      characters,
      duration: roundSeconds(duration),
      speechEnd: roundSeconds(speechEnd),
      sourceSha256: sha256(bytes(source.content)),
      sourceByteLength: bytes(source.content).byteLength
    };
  });
}

function validateMonotonic(entries, label) {
  let previousEnd = -Infinity;
  for (const entry of entries) {
    assert(
      Number.isFinite(entry.global_start_seconds) &&
        Number.isFinite(entry.global_end_seconds) &&
        entry.global_end_seconds >= entry.global_start_seconds,
      `${label} contains an invalid interval`
    );
    assert(entry.global_start_seconds + 1e-9 >= previousEnd, `${label} contains an overlap`);
    previousEnd = entry.global_end_seconds;
  }
}

export function buildActivationDerivativeBundle({
  contentLock,
  lockedSources,
  canonical,
  adaptation,
  production,
  narrationManifest,
  audioSources,
  radioCutBytes
}) {
  validateLockedSources(contentLock, lockedSources);
  assert(radioCutBytes && bytes(radioCutBytes).byteLength > 0, "radio cut bytes are missing");
  const { selected } = validateNarrationSelection({
    production,
    canonical,
    adaptation,
    narrationManifest
  });
  const sources = validateAudioSources(selected, audioSources);

  const timelineScenes = [];
  const words = [];
  const cues = [];
  let globalCursor = 0;
  for (const [sceneIndex, source] of sources.entries()) {
    const globalStart = roundSeconds(globalCursor);
    const sceneWordStart = words.length;
    for (const span of wordSpans(source.record.text)) {
      words.push({
        index: words.length,
        scene_id: source.scene.scene_id,
        narration_id: source.record.id,
        text: span.text,
        local_start_seconds: roundSeconds(source.characters[span.startIndex].start),
        local_end_seconds: roundSeconds(source.characters[span.endIndex].end),
        global_start_seconds: roundSeconds(globalStart + source.characters[span.startIndex].start),
        global_end_seconds: roundSeconds(globalStart + source.characters[span.endIndex].end)
      });
    }
    const sceneCueStart = cues.length;
    for (const span of sentenceSpans(source.record.text)) {
      cues.push({
        id: `cue-${String(cues.length + 1).padStart(2, "0")}`,
        scene_id: source.scene.scene_id,
        narration_id: source.record.id,
        text: span.text,
        global_start_seconds: roundSeconds(globalStart + source.characters[span.startIndex].start),
        global_end_seconds: roundSeconds(globalStart + source.characters[span.endIndex].end)
      });
    }
    const globalEnd = roundSeconds(globalStart + source.duration);
    timelineScenes.push({
      index: sceneIndex,
      scene_id: source.scene.scene_id,
      narration_id: source.record.id,
      audio_file: source.record.file,
      audio_sha256: source.sourceSha256,
      audio_byte_length: source.sourceByteLength,
      global_start_seconds: globalStart,
      global_speech_end_seconds: roundSeconds(globalStart + source.speechEnd),
      global_end_seconds: globalEnd,
      duration_seconds: source.duration,
      word_index_start: sceneWordStart,
      word_index_end: words.length - 1,
      cue_ids: cues.slice(sceneCueStart).map((cue) => cue.id)
    });
    globalCursor = globalEnd;
  }
  validateMonotonic(words, "word timings");
  validateMonotonic(cues, "subtitle cues");

  const totalDuration = timelineScenes.at(-1).global_end_seconds;
  const timeline = {
    schema_version: "activation-radio-timeline/v1",
    content_lock_id: contentLock.lock_id,
    narration_ids: [...SELECTED_NARRATION_IDS],
    total_duration_seconds: totalDuration,
    scenes: timelineScenes,
    cues
  };
  const storyboard = {
    schema_version: "activation-timed-storyboard/v1",
    content_lock_id: contentLock.lock_id,
    total_duration_seconds: totalDuration,
    scenes: production.scenes.map((scene, index) => ({
      scene_id: scene.scene_id,
      canonical_sentence_ids: [...scene.canonical_sentence_ids],
      source_claim_ids: [...scene.source_claim_ids],
      narration_id: scene.narration_id,
      treatment: scene.treatment,
      show_caption_avatar: scene.show_caption_avatar,
      illustration_file: scene.illustration_file,
      static_fallback: scene.static_fallback,
      performance: structuredClone(scene.performance),
      caption_text: sources[index].record.text,
      global_start_seconds: timelineScenes[index].global_start_seconds,
      global_speech_end_seconds: timelineScenes[index].global_speech_end_seconds,
      global_end_seconds: timelineScenes[index].global_end_seconds,
      cue_ids: [...timelineScenes[index].cue_ids]
    }))
  };
  const wordTimings = {
    schema_version: "activation-word-timings/v1",
    content_lock_id: contentLock.lock_id,
    total_duration_seconds: totalDuration,
    words
  };
  const transcript = `${sources.map(({ record }) => record.text).join("\n\n")}\n`;
  const vtt = buildVtt(cues);
  const srt = buildSrt(cues);
  const fileContents = {
    "radio-cut.mp3": bytes(radioCutBytes),
    "timeline.json": Buffer.from(json(timeline)),
    "storyboard.json": Buffer.from(json(storyboard)),
    "word-timings.json": Buffer.from(json(wordTimings)),
    "transcript.txt": Buffer.from(transcript),
    "captions.vtt": Buffer.from(vtt),
    "captions.srt": Buffer.from(srt)
  };
  const files = Object.fromEntries(
    Object.entries(fileContents).map(([name, content]) => [
      name,
      { sha256: sha256(content), byte_length: content.byteLength }
    ])
  );
  const sourceAudio = Object.fromEntries(
    sources.map((source) => [
      source.record.id,
      {
        file: source.record.file,
        sha256: source.sourceSha256,
        byte_length: source.sourceByteLength,
        duration_seconds: source.duration,
        text_sha256: sha256(source.record.text),
        timestamps_sha256: sha256(JSON.stringify(source.record.timestamps)),
        model: source.record.model,
        voice: source.record.voice,
        request_id: source.record.requestId,
        seed: source.record.seed,
        settings: {
          stability: source.record.stability,
          similarity_boost: source.record.similarityBoost,
          speed: source.record.speed,
          output_format: source.record.outputFormat
        },
        source_status: source.record.status
      }
    ])
  );
  const identity = {
    content_lock_id: contentLock.lock_id,
    narration_ids: [...SELECTED_NARRATION_IDS],
    source_audio: sourceAudio,
    files
  };
  const bundleId = `radio:${sha256(JSON.stringify(identity))}`;
  const manifest = {
    schema_version: "activation-radio-derivatives/v1",
    bundle_id: bundleId,
    content_lock_id: contentLock.lock_id,
    private_concept_only: true,
    patient_ready: false,
    narration_ids: [...SELECTED_NARRATION_IDS],
    total_duration_seconds: totalDuration,
    source_audio: sourceAudio,
    files
  };
  fileContents["manifest.json"] = Buffer.from(json(manifest));
  return {
    bundleId,
    manifest,
    timeline,
    storyboard,
    wordTimings,
    transcript,
    vtt,
    srt,
    fileContents
  };
}

export function validateActivationDerivativeBundle({ bundle, ...inputs }) {
  assert(bundle?.manifest?.schema_version === "activation-radio-derivatives/v1", "derivative manifest schema is invalid");
  assert(bundle.manifest.content_lock_id === inputs.contentLock.lock_id, "derivative content lock does not match the current content lock");
  assert(bundle.manifest.patient_ready === false, "derivatives may never be patient-ready");
  validateMonotonic(bundle.wordTimings?.words ?? [], "word timings");
  validateMonotonic(bundle.timeline?.cues ?? [], "subtitle cues");
  const expected = buildActivationDerivativeBundle(inputs);
  for (const key of [
    "bundleId",
    "manifest",
    "timeline",
    "storyboard",
    "wordTimings",
    "transcript",
    "vtt",
    "srt"
  ]) {
    assert(same(bundle[key], expected[key]), `derivative ${key} does not match its locked inputs`);
  }
  for (const [name, content] of Object.entries(bundle.fileContents ?? {})) {
    const expectedContent = expected.fileContents[name];
    assert(expectedContent, `unexpected derivative file ${name}`);
    assert(bytes(content).equals(expectedContent), `derivative file ${name} does not match its locked inputs`);
  }
  assert(
    Object.keys(bundle.fileContents ?? {}).length === Object.keys(expected.fileContents).length,
    "derivative bundle is missing a file"
  );
  return true;
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function withWriterLock(root, operation) {
  await mkdir(root, { recursive: true });
  const lockPath = join(root, ".writer-lock");
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await mkdir(lockPath);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert(acquired, `production writer is busy: ${lockPath}`);
  try {
    return await operation();
  } finally {
    await rmdir(lockPath);
  }
}

export async function persistActivationDerivativeBundle({ stateRoot, runId, bundle }) {
  assert(RUN_ID_PATTERN.test(runId ?? ""), "run id is invalid");
  assert(bundle?.bundleId?.startsWith("radio:"), "radio derivative bundle identity is invalid");
  return withWriterLock(stateRoot, async () => {
    const directory = join(
      stateRoot,
      "runs",
      runId,
      "derivatives",
      bundle.bundleId.slice("radio:".length)
    );
    let reused = true;
    for (const [name, contentValue] of Object.entries(bundle.fileContents)) {
      const path = join(directory, name);
      const content = bytes(contentValue);
      if (await pathExists(path)) {
        const existing = await readFile(path);
        assert(existing.equals(content), `immutable derivative collision at ${path}`);
      } else {
        await atomicWrite(path, content);
        reused = false;
      }
    }
    return { directory, bundle_id: bundle.bundleId, reused };
  });
}

export { EXCLUDED_NARRATION_IDS, SELECTED_NARRATION_IDS };
