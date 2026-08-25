import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildActivationComparisonModel,
  validateActivationComparisonModel
} from "../scripts/lib/activation-production.mjs";
import {
  authorizeCaptureRequest,
  buildAnimaticComparisonManifest,
  createReviewChallenge,
  validateAnimaticComparisonManifest,
  validateReviewReceipt
} from "../scripts/lib/activation-animatics.mjs";

const root = resolve(import.meta.dirname, "..");

async function fixture() {
  const [production, canonical, adaptation, narration] = await Promise.all([
    readJson("content/productions/ci-activation-v0.1.0.json"),
    readJson("content/canonical/ci-phase0-v0.1.0.json"),
    readJson("content/adaptations/activation-programming-v0.1.0.json"),
    readJson("assets/audio/manifest.json")
  ]);
  const activation = canonical.modules.find((module) => module.id === "ci/activation");
  const sentences = new Map(activation.canonical_sentences.map((sentence) => [sentence.id, sentence]));
  const programming = adaptation.formats.chaptered_video;

  return {
    production,
    scenes: production.scenes.map((scene) => {
      const narrationRecord = narration.records.find((record) => record.id === scene.narration_id);
      const text = scene.scene_id === "scene/activation/programming"
        ? programming.blocks.map((block) => block.text).join(" ")
        : scene.canonical_sentence_ids.map((id) => sentences.get(id).text).join(" ");
      const durationSeconds = Math.max(
        ...narrationRecord.timestamps.flatMap((chunk) => chunk.character_end_times_seconds)
      );
      return {
        scene_id: scene.scene_id,
        label: scene.scene_id === "scene/activation/healing"
          ? "After healing"
          : scene.scene_id === "scene/activation/programming"
            ? programming.scene_title
            : "Follow-up visits",
        text,
        timing: {
          narration_id: scene.narration_id,
          duration_seconds: durationSeconds
        },
        illustration: scene.illustration_file
          ? {
              file: scene.illustration_file,
              alt: "Safety-card diagram of the first programming visit."
            }
          : null
      };
    })
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

test("baseline and mixed use identical copy and timing while changing only allowed treatment fields", async () => {
  const inputs = await fixture();
  const baseline = buildActivationComparisonModel({ ...inputs, variant: "baseline" });
  const mixed = buildActivationComparisonModel({ ...inputs, variant: "mixed" });

  assert.deepEqual(
    baseline.scenes.map(({ scene_id, caption, timing }) => ({ scene_id, caption: caption.text, timing })),
    mixed.scenes.map(({ scene_id, caption, timing }) => ({ scene_id, caption: caption.text, timing }))
  );
  assert.deepEqual(
    baseline.scenes.map((scene) => scene.render_treatment),
    ["baseline", "diagram_led", "baseline"]
  );
  assert.deepEqual(
    mixed.scenes.map((scene) => scene.render_treatment),
    ["host_led", "diagram_led", "host_led"]
  );
  assert.equal(validateActivationComparisonModel(baseline), true);
  assert.equal(validateActivationComparisonModel(mixed), true);
});

test("host-led scenes contain one stage host and no avatar; all other treatments contain one avatar", async () => {
  const inputs = await fixture();
  const baseline = buildActivationComparisonModel({ ...inputs, variant: "baseline" });
  const mixed = buildActivationComparisonModel({ ...inputs, variant: "mixed" });

  for (const scene of mixed.scenes) {
    if (scene.render_treatment === "host_led") {
      assert.equal(scene.stage.host_count, 1);
      assert.equal(scene.caption.avatar.count, 0);
      assert.equal(scene.motion.visibly_speaking, true);
      assert.equal(scene.motion.carries_clinical_meaning, false);
    } else {
      assert.equal(scene.stage.host_count, 0);
      assert.equal(scene.caption.avatar.count, 1);
    }
  }
  for (const scene of baseline.scenes) {
    assert.equal(scene.stage.host_count, 0);
    assert.equal(scene.caption.avatar.count, 1);
  }
});

test("compact avatar and caption contracts survive desktop, 390px mobile, and 200% zoom profiles", async () => {
  const inputs = await fixture();
  const model = buildActivationComparisonModel({ ...inputs, variant: "mixed" });

  assert.deepEqual(model.layout_profiles, {
    desktop: { viewport_width_px: 1280, zoom_percent: 100, avatar_size_px: 64 },
    mobile: { viewport_width_px: 390, zoom_percent: 100, avatar_size_px: 48 },
    zoom_200: { viewport_width_px: 640, zoom_percent: 200, avatar_size_px: 48 }
  });
  assert.deepEqual(model.compact_avatar.focal_anchor, { x: 0.5, y: 0.42 });
  assert.equal(model.compact_avatar.preserve_head_and_beak, true);
  assert.equal(model.caption_contract.may_reduce_typography_to_fit_avatar, false);
  assert.equal(model.caption_contract.minimum_font_px, 18);
});

test("reduced motion and blocked or stale generated media resolve to truthful neutral static fallbacks", async () => {
  const inputs = await fixture();
  for (const media_state of ["blocked", "stale"]) {
    const model = buildActivationComparisonModel({
      ...inputs,
      variant: "mixed",
      media_state,
      reduced_motion: true
    });
    assert.equal(model.patient_ready, false);
    assert.equal(model.generated_media_state, media_state);
    for (const scene of model.scenes) {
      assert.equal(scene.motion.mode, "static");
      assert.equal(scene.motion.generated_motion, false);
      assert.equal(scene.motion.finished_motion, false);
      assert.match(scene.static_fallback, /neutral|diagram/);
      assert.ok(scene.caption.text.length > 0);
    }
    assert.equal(validateActivationComparisonModel(model), true);
  }
});

test("comparison validation rejects duplicated hosts, missing captions, and treatment-carried meaning", async () => {
  const inputs = await fixture();
  const model = buildActivationComparisonModel({ ...inputs, variant: "mixed" });

  const duplicated = structuredClone(model);
  duplicated.scenes[0].caption.avatar.count = 1;
  assert.throws(() => validateActivationComparisonModel(duplicated), /duplicate|avatar/i);

  const missingCaption = structuredClone(model);
  missingCaption.scenes[1].caption.text = "";
  assert.throws(() => validateActivationComparisonModel(missingCaption), /caption/i);

  const meaningfulGesture = structuredClone(model);
  meaningfulGesture.scenes[2].motion.carries_clinical_meaning = true;
  assert.throws(() => validateActivationComparisonModel(meaningfulGesture), /clinical meaning/i);
});

test("browser renderer exposes machine-verifiable comparison, fallback, motion, and avatar invariants", async () => {
  const [source, styles] = await Promise.all([
    readFile(resolve(root, "assets/variations.js"), "utf8"),
    readFile(resolve(root, "assets/variations.css"), "utf8")
  ]);
  for (const token of [
    "data-comparison-variant",
    "data-render-treatment",
    "data-stage-host-count",
    "data-caption-avatar-count",
    "data-generated-media-state",
    "data-motion-mode"
  ]) assert.match(source, new RegExp(token));
  assert.match(styles, /\.comparison-host/);
  assert.match(styles, /\.comparison-avatar/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("desktop diagram capture is paint-contained and the host wing gestures only once", async () => {
  const styles = await readFile(resolve(root, "assets/variations.css"), "utf8");
  assert.match(styles, /\.watch-visual--diagram-led\s*\{[^}]*contain:\s*layout paint/s);
  assert.match(
    styles,
    /\.watch-visual--diagram-led \.watch-visual__illustration\s*\{[^}]*max-height:\s*min\(42vh,\s*300px\)[^}]*position:\s*static/s
  );
  assert.match(
    styles,
    /\.is-playing \.comparison-host__wing\s*\{[^}]*animation:[^;}]*\s1\sboth/s
  );
});

test("animatic manifest binds one radio/timeline/canvas and permits only the controlled treatment delta", async () => {
  const inputs = await fixture();
  const baseline = buildActivationComparisonModel({ ...inputs, variant: "baseline" });
  const mixed = buildActivationComparisonModel({ ...inputs, variant: "mixed" });
  const manifest = buildAnimaticComparisonManifest({
    runId: "activation-test",
    contentLockId: `lock:${"a".repeat(64)}`,
    radioBundleId: `radio:${"b".repeat(64)}`,
    radioCutSha256: "c".repeat(64),
    timelineSha256: "d".repeat(64),
    storyboardSha256: "e".repeat(64),
    wordTimingsSha256: "f".repeat(64),
    canvas: { width: 1280, height: 720, fps: 30 },
    renderEnvironment: { browser: "Chromium fixture", os: "fixture", device_pixel_ratio: 1 },
    baseline,
    mixed,
    illustrationSha256: "1".repeat(64)
  });

  assert.equal(validateAnimaticComparisonManifest(manifest), true);
  assert.deepEqual(manifest.review_facing.labels, ["Candidate A", "Candidate B"]);
  assert.equal(JSON.stringify(manifest.review_facing).includes("baseline"), false);
  assert.equal(JSON.stringify(manifest.review_facing).includes("mixed"), false);

  const drifted = structuredClone(manifest);
  drifted.candidates.mixed.scenes[1].caption.text += " drift";
  assert.throws(() => validateAnimaticComparisonManifest(drifted), /controlled|caption|copy/i);
});

test("capture policy is loopback-only, token-protected, method-limited, and path-allowlisted", () => {
  const policy = {
    port: 43123,
    token: "capture-secret",
    allowedPaths: new Set(["/variations.html", "/assets/variations.js"])
  };
  assert.equal(authorizeCaptureRequest({
    method: "GET",
    host: "127.0.0.1:43123",
    url: "/variations.html",
    token: "capture-secret",
    policy
  }).allowed, true);

  for (const request of [
    { method: "GET", host: "localhost:43123", url: "/variations.html", token: "capture-secret" },
    { method: "POST", host: "127.0.0.1:43123", url: "/variations.html", token: "capture-secret" },
    { method: "GET", host: "127.0.0.1:43123", url: "/.production/run.json", token: "capture-secret" },
    { method: "GET", host: "127.0.0.1:43123", url: "/.git/config", token: "capture-secret" },
    { method: "GET", host: "127.0.0.1:43123", url: "/.env.local", token: "capture-secret" },
    { method: "GET", host: "127.0.0.1:43123", url: "/assets/%2e%2e/.env", token: "capture-secret" },
    { method: "GET", host: "127.0.0.1:43123", url: "/assets/variations.js", token: "wrong" }
  ]) {
    assert.equal(authorizeCaptureRequest({ ...request, policy }).allowed, false);
  }
});

test("review receipts are single-packet, role-bound, and prove both neutral cuts were viewed before scoring", () => {
  const issued = createReviewChallenge({
    packetId: `packet:${"2".repeat(64)}`,
    role: "independent_designer",
    evaluatorId: "fresh-designer-1",
    artifactHashes: { candidate_a: "3".repeat(64), candidate_b: "4".repeat(64) },
    reviewerPromptHash: "5".repeat(64),
    rubricVersion: "activation-animatic-rubric/v1",
    model: "fixture-model",
    inferenceConfiguration: { reasoning: "high" },
    allowedToolPolicy: ["local_artifact_read", "ffprobe"]
  });
  const receipt = {
    schema_version: "activation-review-receipt/v1",
    challenge_id: issued.challenge.challenge_id,
    challenge_token: issued.token,
    packet_id: issued.challenge.packet_id,
    role: issued.challenge.role,
    evaluator_id: issued.challenge.evaluator_id,
    reviewer_prompt_hash: issued.challenge.reviewer_prompt_hash,
    rubric_version: issued.challenge.rubric_version,
    model: issued.challenge.model,
    inference_configuration: issued.challenge.inference_configuration,
    allowed_tool_policy: issued.challenge.allowed_tool_policy,
    artifact_hashes: issued.challenge.artifact_hashes,
    viewing_events: [
      { candidate: "Candidate A", event: "completed", sequence: 1 },
      { candidate: "Candidate B", event: "completed", sequence: 2 },
      { event: "rubric_revealed", sequence: 3 },
      { event: "scored", sequence: 4 }
    ],
    dimensions: {
      orientation: "pass",
      comprehension: "pass",
      recall: "pass",
      accessibility: "pass",
      mascot_distraction: "pass",
      caption_integrity: "pass"
    },
    critical_failures: [],
    disposition: "pass",
    findings: []
  };
  assert.equal(validateReviewReceipt({ challenge: issued.challenge, receipt }), true);

  const earlyScore = structuredClone(receipt);
  earlyScore.viewing_events[1] = { event: "scored", sequence: 2 };
  assert.throws(() => validateReviewReceipt({ challenge: issued.challenge, receipt: earlyScore }), /both|view|score/i);

  const wrongRole = structuredClone(receipt);
  wrongRole.role = "simulated_user";
  assert.throws(() => validateReviewReceipt({ challenge: issued.challenge, receipt: wrongRole }), /role/i);
});
