import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildActivationDerivativeBundle,
  persistActivationDerivativeBundle,
  SELECTED_NARRATION_IDS,
  validateActivationDerivativeBundle
} from "./lib/activation-derivatives.mjs";
import {
  addArtifact,
  applyRunEvent,
  createArtifactRecord,
  persistRunRevision,
  validateRunState
} from "./lib/production-run.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCKED_SOURCE_PATHS = Object.freeze({
  canonical_module: "content/canonical/ci-phase0-v0.1.0.json",
  activation_adaptation: "content/adaptations/activation-programming-v0.1.0.json",
  activation_production_contract: "content/productions/ci-activation-v0.1.0.json"
});
const EXPECTED_AUDIO_PATHS = Object.freeze({
  healing: "assets/audio/healing.mp3",
  "chaptered-programming": "assets/audio/chaptered-programming.mp3",
  "follow-up": "assets/audio/follow-up.mp3"
});
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;
const REVISION_ID_PATTERN = /^revision:[a-f0-9]{64}$/;
const LOCK_ID_PATTERN = /^lock:[a-f0-9]{64}$/;

function parseArguments(argv) {
  const options = {
    stateRoot: resolve(repositoryRoot, ".production/activation"),
    runId: null,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--state-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--state-root requires a path");
      options.stateRoot = resolve(value);
      index += 1;
    } else if (argument === "--run-id") {
      const value = argv[index + 1];
      if (!value) throw new Error("--run-id requires a value");
      options.runId = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!options.runId) throw new Error("--run-id is required");
  if (!RUN_ID_PATTERN.test(options.runId)) throw new Error("--run-id is invalid");
  return options;
}

async function loadRunAndLock(stateRoot, runId) {
  const runRoot = join(stateRoot, "runs", runId);
  const pointer = JSON.parse(await readFile(join(runRoot, "current.json"), "utf8"));
  if (pointer.run_id !== runId || !REVISION_ID_PATTERN.test(pointer.revision_id ?? "")) {
    throw new Error("run pointer is invalid");
  }
  const run = JSON.parse(
    await readFile(
      join(runRoot, "revisions", `${pointer.revision_id.slice("revision:".length)}.json`),
      "utf8"
    )
  );
  validateRunState(run);
  if (run.stage !== "radio_derivation" && run.stage !== "animatic_review") {
    throw new Error(
      `radio derivation requires radio_derivation stage (or an unchanged animatic_review rerun), not ${run.stage}`
    );
  }
  if (!LOCK_ID_PATTERN.test(run.current_content_lock_id ?? "")) {
    throw new Error("run content lock identity is invalid");
  }
  const lockSha = run.current_content_lock_id.slice("lock:".length);
  const contentLock = JSON.parse(await readFile(join(stateRoot, "locks", `${lockSha}.json`), "utf8"));
  if (contentLock.lock_id !== run.current_content_lock_id) {
    throw new Error("run and persisted content lock do not match");
  }
  return { run, contentLock };
}

async function loadInputs(contentLock) {
  const lockedSources = Object.fromEntries(
    await Promise.all(
      Object.entries(LOCKED_SOURCE_PATHS).map(async ([id, sourcePath]) => [
        id,
        { sourcePath, content: await readFile(join(repositoryRoot, sourcePath)) }
      ])
    )
  );
  const canonical = JSON.parse(lockedSources.canonical_module.content);
  const adaptation = JSON.parse(lockedSources.activation_adaptation.content);
  const production = JSON.parse(lockedSources.activation_production_contract.content);
  const narrationManifest = JSON.parse(
    await readFile(join(repositoryRoot, "assets/audio/manifest.json"), "utf8")
  );
  const records = new Map(narrationManifest.records.map((record) => [record.id, record]));
  const audioSources = {};
  for (const id of SELECTED_NARRATION_IDS) {
    const record = records.get(id);
    if (!record) throw new Error(`${id}: narration record is missing`);
    if (record.file !== EXPECTED_AUDIO_PATHS[id]) {
      throw new Error(`${id}: narration audio path is not allowlisted`);
    }
    const path = join(repositoryRoot, record.file);
    const [{ stdout }, content] = await Promise.all([
      execFile("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path
      ]),
      readFile(path)
    ]);
    audioSources[id] = { content, durationSeconds: Number(stdout.trim()) };
  }
  return {
    contentLock,
    lockedSources,
    canonical,
    adaptation,
    production,
    narrationManifest,
    audioSources
  };
}

function escapeConcatPath(path) {
  return path.replaceAll("'", "'\\''");
}

async function buildRadioCut(narrationManifest) {
  const records = new Map(narrationManifest.records.map((record) => [record.id, record]));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "activation-radio-"));
  try {
    const listPath = join(temporaryRoot, "concat.txt");
    const outputPath = join(temporaryRoot, "radio-cut.mp3");
    const list = `${SELECTED_NARRATION_IDS.map((id) => {
      const record = records.get(id);
      if (!record) throw new Error(`${id}: narration record is missing`);
      if (record.file !== EXPECTED_AUDIO_PATHS[id]) {
        throw new Error(`${id}: narration audio path is not allowlisted`);
      }
      return `file '${escapeConcatPath(join(repositoryRoot, record.file))}'`;
    }).join("\n")}\n`;
    await writeFile(listPath, list, { encoding: "utf8", mode: 0o600 });
    await execFile("ffmpeg", [
      "-v",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-map_metadata",
      "-1",
      "-c",
      "copy",
      "-id3v2_version",
      "0",
      "-write_xing",
      "0",
      outputPath
    ]);
    const [{ stdout }, content] = await Promise.all([
      execFile("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        outputPath
      ]),
      readFile(outputPath)
    ]);
    return { content, durationSeconds: Number(stdout.trim()) };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function recordDerivativeArtifacts(run, bundle) {
  validateRunState(run);
  if (bundle.manifest.content_lock_id !== run.current_content_lock_id) {
    throw new Error("radio derivative bundle is not bound to the current content lock");
  }
  const priorManifests = run.artifacts.filter(
    (artifact) => artifact.kind === "activation_radio_manifest"
  );
  const sameBundle = priorManifests.find(
    (artifact) => artifact.provenance.bundle_id === bundle.bundleId
  );
  if (run.stage === "animatic_review" && priorManifests.length > 0 && !sameBundle) {
    throw new Error(
      "narration or audio source drifted after radio derivation; return the run to radio_derivation before rebuilding"
    );
  }
  const directory = `derivatives/${bundle.bundleId.slice("radio:".length)}`;
  const provenance = {
    source: "deterministic_builder",
    builder: "activation-derivatives/v1",
    bundle_id: bundle.bundleId,
    narration_ids: [...bundle.manifest.narration_ids],
    source_audio: structuredClone(bundle.manifest.source_audio),
    automatic_validation: "passed"
  };
  let next = run;
  let radioArtifactId = null;
  const derivativeArtifactIds = [];
  for (const name of [
    "radio-cut.mp3",
    "timeline.json",
    "storyboard.json",
    "word-timings.json",
    "transcript.txt",
    "captions.vtt",
    "captions.srt"
  ]) {
    const artifact = createArtifactRecord({
      kind: `activation_${name.replaceAll(/[^a-z0-9]+/gu, "_").replace(/^_|_$/gu, "")}`,
      outputHash: bundle.manifest.files[name].sha256,
      contentLockId: run.current_content_lock_id,
      directInputIds:
        name === "radio-cut.mp3"
          ? [run.current_content_lock_id]
          : [run.current_content_lock_id, radioArtifactId],
      filePath: `${directory}/${name}`,
      provenance,
      reviewState: "approved"
    });
    next = addArtifact(next, artifact);
    derivativeArtifactIds.push(artifact.candidate_asset_id);
    if (name === "radio-cut.mp3") radioArtifactId = artifact.candidate_asset_id;
  }
  const manifestArtifact = createArtifactRecord({
    kind: "activation_radio_manifest",
    outputHash: createHash("sha256").update(bundle.fileContents["manifest.json"]).digest("hex"),
    contentLockId: run.current_content_lock_id,
    directInputIds: [run.current_content_lock_id, ...derivativeArtifactIds],
    filePath: `${directory}/manifest.json`,
    provenance,
    reviewState: "approved"
  });
  next = addArtifact(next, manifestArtifact);
  if (next.stage === "radio_derivation") next = applyRunEvent(next, "radio_derivation_completed");
  return next;
}

export async function buildActivationDerivatives({ stateRoot, runId }) {
  const { run, contentLock } = await loadRunAndLock(stateRoot, runId);
  const inputs = await loadInputs(contentLock);
  const radioCut = await buildRadioCut(inputs.narrationManifest);
  const expectedDuration = Object.values(inputs.audioSources).reduce(
    (total, source) => total + source.durationSeconds,
    0
  );
  if (
    !Number.isFinite(radioCut.durationSeconds) ||
    Math.abs(radioCut.durationSeconds - expectedDuration) > 0.002
  ) {
    throw new Error(
      `radio cut duration ${radioCut.durationSeconds} does not match segment timeline ${expectedDuration}`
    );
  }
  const radioCutBytes = radioCut.content;
  const bundle = buildActivationDerivativeBundle({ ...inputs, radioCutBytes });
  validateActivationDerivativeBundle({ bundle, ...inputs, radioCutBytes });
  const persistence = await persistActivationDerivativeBundle({ stateRoot, runId, bundle });
  const nextRun = recordDerivativeArtifacts(run, bundle);
  const runPersistence = await persistRunRevision(stateRoot, nextRun);
  return {
    run_id: runId,
    content_lock_id: contentLock.lock_id,
    radio_bundle_id: bundle.bundleId,
    total_duration_seconds: bundle.timeline.total_duration_seconds,
    narration_ids: bundle.manifest.narration_ids,
    derivative_directory: relative(repositoryRoot, persistence.directory),
    derivatives_reused: persistence.reused,
    run_revision_reused: runPersistence.reused,
    revision_id: runPersistence.revision_id,
    stage: nextRun.stage,
    status: nextRun.status,
    reason_code: nextRun.reason_code,
    resume_action: nextRun.resume_action
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await buildActivationDerivatives(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Activation radio ${result.radio_bundle_id} (${result.derivatives_reused ? "reused" : "created"}); ` +
        `${result.total_duration_seconds}s across ${result.narration_ids.join(", ")}. ` +
        `Run ${result.run_id} is ${result.status} at ${result.stage}.\n`
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
