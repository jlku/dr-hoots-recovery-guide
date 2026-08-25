import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildScrollyProjection,
  validateScrollyProjection
} from "../scripts/lib/activation-export.mjs";
import { buildActivationDerivativeBundle } from "../scripts/lib/activation-derivatives.mjs";
import { buildContentLock } from "../scripts/lib/production-run.mjs";

const root = new URL("../", import.meta.url);
const sourcePaths = {
  canonical_module: "content/canonical/ci-phase0-v0.1.0.json",
  activation_adaptation: "content/adaptations/activation-programming-v0.1.0.json",
  activation_production_contract: "content/productions/ci-activation-v0.1.0.json"
};

async function fixture() {
  const lockedSources = Object.fromEntries(
    await Promise.all(
      Object.entries(sourcePaths).map(async ([id, sourcePath]) => [
        id,
        { sourcePath, content: await readFile(new URL(sourcePath, root)) }
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
    toolVersions: { renderer: "activation-export-test/v1" }
  });
  const production = JSON.parse(lockedSources.activation_production_contract.content);
  const narrationManifest = JSON.parse(
    await readFile(new URL("assets/audio/manifest.json", root), "utf8")
  );
  const audioSources = Object.fromEntries(
    await Promise.all(
      ["healing", "chaptered-programming", "follow-up"].map(async (id) => {
        const record = narrationManifest.records.find((candidate) => candidate.id === id);
        const speechEnd = Math.max(
          ...record.timestamps.flatMap((chunk) => chunk.character_end_times_seconds)
        );
        return [
          id,
          {
            content: await readFile(new URL(record.file, root)),
            durationSeconds: Number((speechEnd + 0.045).toFixed(6))
          }
        ];
      })
    )
  );
  const bundle = buildActivationDerivativeBundle({
    contentLock,
    lockedSources,
    canonical: JSON.parse(lockedSources.canonical_module.content),
    adaptation: JSON.parse(lockedSources.activation_adaptation.content),
    production,
    narrationManifest,
    audioSources,
    radioCutBytes: Buffer.from("activation-export-test-radio-cut")
  });
  return {
    production,
    timeline: bundle.timeline,
    transcript: bundle.transcript,
    contentLockId: contentLock.lock_id,
    radioBundleId: bundle.bundleId
  };
}

test("semantic scrollytelling projection preserves the locked three-beat content without JavaScript", async () => {
  const { production, timeline, transcript, contentLockId, radioBundleId } = await fixture();
  const projection = buildScrollyProjection({
    production,
    timeline,
    transcript,
    contentLockId,
    radioBundleId,
    assetPaths: {
      host: "assets/character/dr-hoots-motion-base-v2.png",
      diagram: "assets/illustrations/ci-activation-programming-safety-card-v1.png",
      captions: "captions.vtt"
    }
  });

  assert.match(projection.manifest.projection_id, /^projection:[a-f0-9]{64}$/);
  assert.deepEqual(projection.manifest.scene_order, production.scene_order);
  assert.equal(projection.manifest.patient_ready, false);
  assert.equal(projection.manifest.javascript_required_for_content, false);
  assert.equal(projection.manifest.reversible_back_scrolling, true);

  for (const cue of timeline.cues) {
    assert.ok(projection.html.includes(cue.text), "missing cue: " + cue.id);
  }
  for (const heading of ["After healing", "First programming visit", "Follow-up visits"]) {
    assert.ok(projection.html.includes(heading), "missing heading: " + heading);
  }
  assert.match(projection.html, /<main id="main-content">/);
  assert.match(projection.html, /<ol class="story-index"/);
  assert.match(projection.html, /<article[^>]+data-scene-id="scene\/activation\/healing"/);
  assert.match(projection.html, /<article[^>]+data-scene-id="scene\/activation\/programming"/);
  assert.match(projection.html, /<article[^>]+data-scene-id="scene\/activation\/follow-up"/);
  assert.match(projection.html, /<noscript>/);
  assert.match(projection.html, /prefers-reduced-motion: reduce/);
  assert.match(projection.html, /min-height: 44px/);
  assert.match(projection.html, /IntersectionObserver/);
  assert.match(projection.html, /An audiologist programs an outside-ear speech processor for the person&#39;s needs/);
  assert.match(projection.html, /Private prototype · unverified draft · not for patient use/);
  assert.ok(projection.html.includes(transcript.trim()));
  assert.equal(validateScrollyProjection(projection), true);
});

test("projection identity changes with visible-copy drift and stale expected hashes are rejected", async () => {
  const fixtureData = await fixture();
  const options = {
    ...fixtureData,
    assetPaths: {
      host: "assets/character/dr-hoots-motion-base-v2.png",
      diagram: "assets/illustrations/ci-activation-programming-safety-card-v1.png",
      captions: "captions.vtt"
    }
  };
  const original = buildScrollyProjection(options);
  const changedTimeline = structuredClone(fixtureData.timeline);
  changedTimeline.cues[0].text += " Changed.";
  const changed = buildScrollyProjection({ ...options, timeline: changedTimeline });
  assert.notEqual(changed.manifest.projection_id, original.manifest.projection_id);
  assert.throws(
    () => validateScrollyProjection(changed, {
      expectedProjectionId: original.manifest.projection_id
    }),
    /stale projection/i
  );
});
