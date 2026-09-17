// tests/v2-frames.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { FRAME_KINDS, loadFrameManifest, validateFrames } from "../scripts/lib/frames.mjs";
import { loadSegmentBundle } from "../scripts/lib/segments.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const frames = await loadFrameManifest(root);

test("the repository frame manifest covers every beat with real files and alt text", async () => {
  const result = await validateFrames({ frames, segments: bundle.segments, root });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(FRAME_KINDS, ["svg", "image", "text"]);
  assert.equal(frames.frames["frame-13-programming"].kind, "image");
  assert.equal(frames.frames["frame-12-healing"].kind, "text");
});

test("the validator rejects unknown frames, missing files, bad kinds, and missing alt text", async () => {
  const broken = structuredClone(frames);
  const segments = structuredClone(bundle.segments);
  segments.segments[0].beats[0].frame = "frame-nope";
  broken.frames["frame-06-redness"].src = "preview/assets/cards/does-not-exist.svg";
  broken.frames["frame-11-numbers"].alt = " ";
  broken.frames["frame-12-healing"].src = "preview/assets/cards/frame-01.svg";
  broken.frames["frame-0405-milestones"].kind = "video";
  const result = await validateFrames({ frames: broken, segments, root });
  const text = result.errors.join("\n");
  assert.match(text, /beat\/dressing-off uses frame frame-nope, which is not in the manifest/);
  assert.match(text, /frame-06-redness src preview\/assets\/cards\/does-not-exist\.svg does not exist/);
  assert.match(text, /frame-11-numbers needs alt text/);
  assert.match(text, /frame-12-healing is a text frame and must not have src/);
  assert.match(text, /frame-0405-milestones has unsupported kind video/);
  assert.match(result.warnings.join("\n"), /frame-01 is not used by any beat/);
});
