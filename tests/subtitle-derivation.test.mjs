import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  buildActivationDerivativeBundle,
  persistActivationDerivativeBundle,
  validateActivationDerivativeBundle
} from "../scripts/lib/activation-derivatives.mjs";
import {
  buildActivationDerivatives,
  recordDerivativeArtifacts
} from "../scripts/build-activation-derivatives.mjs";
import {
  applyRunEvent,
  buildContentLock,
  createProductionRun,
  persistContentLock,
  persistRunRevision
} from "../scripts/lib/production-run.mjs";

const root = resolve(import.meta.dirname, "..");
const sourcePaths = {
  canonical_module: "content/canonical/ci-phase0-v0.1.0.json",
  activation_adaptation: "content/adaptations/activation-programming-v0.1.0.json",
  activation_production_contract: "content/productions/ci-activation-v0.1.0.json"
};
const hasFfprobe = spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

async function fixture() {
  const lockedSources = Object.fromEntries(
    await Promise.all(
      Object.entries(sourcePaths).map(async ([id, sourcePath]) => [
        id,
        { sourcePath, content: await readFile(join(root, sourcePath)) }
      ])
    )
  );
  const contentLock = buildContentLock({
    inputs: Object.entries(lockedSources).map(([id, source]) => ({
      id,
      sourcePath: source.sourcePath,
      content: source.content
    })),
    renderConfig: { canvas: { width: 1280, height: 720 } },
    toolVersions: { renderer: "fixture/v1" }
  });
  const canonical = JSON.parse(lockedSources.canonical_module.content);
  const adaptation = JSON.parse(lockedSources.activation_adaptation.content);
  const production = JSON.parse(lockedSources.activation_production_contract.content);
  const narrationManifest = JSON.parse(
    await readFile(join(root, "assets/audio/manifest.json"), "utf8")
  );
  const selected = ["healing", "chaptered-programming", "follow-up"];
  const audioSources = Object.fromEntries(
    await Promise.all(
      selected.map(async (id) => {
        const record = narrationManifest.records.find((candidate) => candidate.id === id);
        const speechEnd = Math.max(
          ...record.timestamps.flatMap((chunk) => chunk.character_end_times_seconds)
        );
        return [
          id,
          {
            content: await readFile(join(root, record.file)),
            durationSeconds: Number((speechEnd + 0.045).toFixed(6))
          }
        ];
      })
    )
  );
  const radioCutBytes = Buffer.from("fixture-radio-cut");
  return {
    contentLock,
    lockedSources,
    canonical,
    adaptation,
    production,
    narrationManifest,
    audioSources,
    radioCutBytes
  };
}

test("derives one exact three-scene radio timeline, storyboard, transcript, VTT, SRT, and word clock", async () => {
  const inputs = await fixture();
  const bundle = buildActivationDerivativeBundle(inputs);

  assert.deepEqual(bundle.manifest.narration_ids, [
    "healing",
    "chaptered-programming",
    "follow-up"
  ]);
  assert.deepEqual(
    bundle.timeline.scenes.map((scene) => scene.scene_id),
    inputs.production.scene_order
  );
  assert.equal(bundle.timeline.scenes[0].global_start_seconds, 0);
  assert.equal(
    bundle.timeline.scenes[1].global_start_seconds,
    bundle.timeline.scenes[0].global_end_seconds
  );
  assert.equal(
    bundle.timeline.scenes[2].global_start_seconds,
    bundle.timeline.scenes[1].global_end_seconds
  );
  assert.equal(
    bundle.timeline.total_duration_seconds,
    bundle.timeline.scenes.at(-1).global_end_seconds
  );
  assert.equal(bundle.storyboard.content_lock_id, inputs.contentLock.lock_id);
  assert.equal(bundle.wordTimings.words[0].text, "After");
  assert.equal(bundle.wordTimings.words.at(-1).text, "fine-tuning.");
  assert.equal(
    bundle.transcript,
    inputs.production.scenes
      .map((scene) =>
        inputs.narrationManifest.records.find((record) => record.id === scene.narration_id).text
      )
      .join("\n\n") + "\n"
  );
  assert.match(bundle.vtt, /^WEBVTT\n\n1\n00:00:00\.000 --> 00:00:/);
  assert.match(bundle.srt, /^1\n00:00:00,000 --> 00:00:/);
  assert.equal(bundle.manifest.files["radio-cut.mp3"].sha256.length, 64);
  assert.equal(
    bundle.manifest.source_audio.healing.request_id,
    inputs.narrationManifest.records.find((record) => record.id === "healing").requestId
  );
  assert.equal(bundle.manifest.source_audio.healing.timestamps_sha256.length, 64);
  assert.equal(validateActivationDerivativeBundle({ bundle, ...inputs }), true);
});

test("rejects altered copy, missing timing, overlapping derived cues, and a foreign content lock", async () => {
  const inputs = await fixture();

  const changedCopy = structuredClone(inputs.narrationManifest);
  changedCopy.records.find((record) => record.id === "healing").text += " Soon.";
  assert.throws(
    () => buildActivationDerivativeBundle({ ...inputs, narrationManifest: changedCopy }),
    /spoken copy/i
  );

  const missingTiming = structuredClone(inputs.narrationManifest);
  missingTiming.records.find((record) => record.id === "healing").timestamps[0]
    .character_end_times_seconds.pop();
  assert.throws(
    () => buildActivationDerivativeBundle({ ...inputs, narrationManifest: missingTiming }),
    /timestamp/i
  );

  const bundle = buildActivationDerivativeBundle(inputs);
  const overlapping = structuredClone(bundle);
  overlapping.wordTimings.words[1].global_start_seconds = 0;
  assert.throws(
    () => validateActivationDerivativeBundle({ bundle: overlapping, ...inputs }),
    /overlap|does not match/i
  );

  const foreignLock = buildContentLock({
    inputs: [
      {
        id: "canonical_module",
        sourcePath: sourcePaths.canonical_module,
        content: "foreign canonical"
      }
    ]
  });
  assert.throws(
    () =>
      validateActivationDerivativeBundle({
        bundle,
        ...inputs,
        contentLock: foreignLock
      }),
    /content lock|locked source/i
  );
});

test("rejects welcome and linear-programming tracks from the activation radio contract", async () => {
  const inputs = await fixture();
  for (const excludedId of ["linear-welcome", "chaptered-welcome", "linear-programming"]) {
    const production = structuredClone(inputs.production);
    production.scenes[1].narration_id = excludedId;
    assert.throws(
      () => buildActivationDerivativeBundle({ ...inputs, production }),
      /narration order|excluded/i
    );
  }

  const movedAudio = structuredClone(inputs.narrationManifest);
  movedAudio.records.find((record) => record.id === "healing").file = "../private/healing.mp3";
  assert.throws(
    () => buildActivationDerivativeBundle({ ...inputs, narrationManifest: movedAudio }),
    /not allowlisted/i
  );
});

test("rejects locked source drift and reuses unchanged immutable derivative files", async () => {
  const inputs = await fixture();
  const driftedSources = structuredClone(inputs.lockedSources);
  driftedSources.canonical_module.content = Buffer.from(
    `${driftedSources.canonical_module.content.toString("utf8")}\n`
  );
  assert.throws(
    () => buildActivationDerivativeBundle({ ...inputs, lockedSources: driftedSources }),
    /locked source/i
  );

  const bundle = buildActivationDerivativeBundle(inputs);
  const stateRoot = await mkdtemp(join(tmpdir(), "activation-derivatives-"));
  const first = await persistActivationDerivativeBundle({
    stateRoot,
    runId: "fixture-run",
    bundle
  });
  const manifestPath = join(first.directory, "manifest.json");
  const before = await stat(manifestPath);
  const second = await persistActivationDerivativeBundle({
    stateRoot,
    runId: "fixture-run",
    bundle
  });
  const after = await stat(manifestPath);

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), bundle.manifest);
});

test("registers the validated bundle in the run graph, advances once, and blocks post-lock audio drift", async () => {
  const inputs = await fixture();
  const bundle = buildActivationDerivativeBundle(inputs);
  let run = createProductionRun({ runId: "graph-fixture", contentLock: inputs.contentLock });
  run = applyRunEvent(run, "content_lock_approved");

  const advanced = recordDerivativeArtifacts(run, bundle);
  assert.equal(advanced.stage, "animatic_review");
  assert.equal(advanced.reason_code, "animatic_review_required");
  assert.equal(advanced.artifacts.length, 8);
  assert.equal(advanced.valid_artifacts.length, 8);
  assert.ok(
    advanced.artifacts.every(
      (artifact) => artifact.content_lock_id === inputs.contentLock.lock_id
    )
  );

  const unchanged = recordDerivativeArtifacts(advanced, bundle);
  assert.equal(unchanged.artifacts.length, 8);
  assert.equal(unchanged.state_events.length, advanced.state_events.length);

  const drifted = structuredClone(bundle);
  drifted.bundleId = `radio:${"f".repeat(64)}`;
  assert.throws(
    () => recordDerivativeArtifacts(advanced, drifted),
    /audio source drifted|return.*radio_derivation/i
  );
});

test("assembles the real private radio cut and reuses its persisted hash-bound run revision", {
  skip: hasFfprobe ? false : "ffprobe is not installed"
}, async () => {
  const inputs = await fixture();
  const stateRoot = await mkdtemp(join(tmpdir(), "activation-radio-cli-"));
  const runId = "radio-integration";
  let run = createProductionRun({ runId, contentLock: inputs.contentLock });
  run = applyRunEvent(run, "content_lock_approved");
  await persistContentLock(stateRoot, inputs.contentLock);
  await persistRunRevision(stateRoot, run);

  const first = await buildActivationDerivatives({ stateRoot, runId });
  assert.equal(first.stage, "animatic_review");
  assert.equal(first.reason_code, "animatic_review_required");
  assert.equal(first.total_duration_seconds, 23.170564);
  assert.equal(first.derivatives_reused, false);

  const second = await buildActivationDerivatives({ stateRoot, runId });
  assert.equal(second.radio_bundle_id, first.radio_bundle_id);
  assert.equal(second.derivatives_reused, true);
  assert.equal(second.run_revision_reused, true);
});
