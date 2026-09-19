// tests/v2-frames.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { FRAME_KINDS, loadFrameManifest, validateFrames } from "../scripts/lib/frames.mjs";
import { readFile } from "node:fs/promises";

import { loadSegmentBundle } from "../scripts/lib/segments.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const frames = await loadFrameManifest(root);
const englishLabels = JSON.parse(await readFile(resolve(root, "content/translations/en/ci-phase0-v0.1.0.json"), "utf8")).labels;

test("the repository frame manifest covers every beat with real files and alt text", async () => {
  const result = await validateFrames({ frames, segments: bundle.segments, root, labels: englishLabels });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(FRAME_KINDS, ["svg", "image", "text", "composite", "panels"]);
  assert.equal(frames.frames["frame-13-programming"].kind, "composite");
  assert.equal(frames.frames["frame-12-healing"].kind, "text");
});

test("the validator rejects unknown frames, missing files, bad kinds, and missing alt text", async () => {
  const broken = structuredClone(frames);
  const segments = structuredClone(bundle.segments);
  segments.segments[0].beats[0].frame = "frame-nope";
  broken.frames["frame-svg"] = { kind: "svg", src: "preview/assets/cards/does-not-exist.svg", alt: "x" };
  broken.frames["frame-image"] = { kind: "image", src: "assets/illustrations/ci-activation-programming-safety-card-v1.png", alt: " " };
  broken.frames["frame-12-healing"].src = "preview/assets/cards/frame-01.svg";
  broken.frames["frame-0405-milestones"].kind = "video";
  const result = await validateFrames({ frames: broken, segments, root, labels: englishLabels });
  const text = result.errors.join("\n");
  assert.match(text, /beat\/dressing-off uses frame frame-nope, which is not in the manifest/);
  assert.match(text, /frame-svg src preview\/assets\/cards\/does-not-exist\.svg does not exist/);
  assert.match(text, /frame-image needs alt text/);
  assert.match(text, /frame-12-healing is a text frame and must not have src/);
  assert.match(text, /frame-0405-milestones has unsupported kind video/);
  assert.match(result.warnings.join("\n"), /frame-01 is not used by any beat/);
});

test("composite frames name accepted layers, anchors within the image, overlays with labels and sentence ids", async () => {
  const composites = Object.entries(frames.frames).filter(([, frame]) => frame.kind === "composite");
  assert.ok(composites.length >= 3);
  const broken = structuredClone(frames);
  const [id, frame] = composites[0];
  broken.frames[id] = { ...frame, anchors: { bad: { x: 2, y: 0.5 } }, states: [{ id: "s", image: "missing-layer" }], overlays: [{ id: "o", type: "unknown", label_key: "ov.nope", sentence_ids: ["zz.99"] }] };
  const result = await validateFrames({ frames: broken, segments: bundle.segments, root, labels: englishLabels });
  const text = result.errors.join("\n");
  assert.match(text, new RegExp(`${id} anchor bad must sit within the image`));
  assert.match(text, new RegExp(`${id} state s names layer missing-layer`));
  assert.match(text, new RegExp(`${id} overlay o has unsupported type unknown`));
  assert.match(text, new RegExp(`${id} overlay o label ov\\.nope is not in the English pack`));
  assert.match(text, new RegExp(`${id} overlay o sentence zz\\.99 is not spoken by a beat that uses this frame`));
});

test("this version is static: no composite swaps states during a beat, and a motion is drawn as numbered panels", async () => {
  assert.equal(frames.motion, "static");
  const removal = frames.frames["frame-01"];
  assert.equal(removal.kind, "panels");
  assert.deepEqual(removal.panels.map((panel) => panel.number), [1, 2, 3, 4]);
  assert.ok(removal.panels.some((panel) => (panel.overlays ?? []).some((overlay) => overlay.type === "motion-arrow")), "the moving step carries an arrow");
  for (const frame of Object.values(frames.frames)) assert.ok((frame.states ?? []).length <= 1);
  const broken = structuredClone(frames);
  broken.frames["frame-06-redness"].states = [{ id: "a", image: "fluid", until: "red" }, { id: "b", image: "fluid", from: "red" }];
  broken.frames["frame-01"].panels[1].overlays[0].from = "remove";
  broken.frames["frame-01"].panels[2].number = 7;
  broken.frames["frame-01"].panels[3].label_key = "ov.nope";
  const result = await validateFrames({ frames: broken, segments: bundle.segments, root, labels: englishLabels });
  const text = result.errors.join("\n");
  assert.match(text, /frame-06-redness swaps 2 states during a beat, which the static version forbids/);
  assert.match(text, /frame-01 panel pull-away overlay pull is timed, but a panel is static/);
  assert.match(text, /frame-01 panel numbers must run 1, 2, 3 in order/);
  assert.match(text, /frame-01 panel tape-check label ov\.nope is not in the English pack/);
});
