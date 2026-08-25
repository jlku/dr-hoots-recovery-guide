import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("the canonical Watch route hosts the complete mascot-led guide rather than the animatic", async () => {
  const [source, styles, html, guideHtml, playerSource, playerStyles, frameSource] = await Promise.all([
    readFile(resolve(root, "assets/variations.js"), "utf8"),
    readFile(resolve(root, "assets/variations.css"), "utf8"),
    readFile(resolve(root, "variations.html"), "utf8"),
    readFile(resolve(root, "preview/guide-video.html"), "utf8"),
    readFile(resolve(root, "preview/assets/animatic-video.js"), "utf8"),
    readFile(resolve(root, "preview/assets/animatic-video.css"), "utf8"),
    readFile(resolve(root, "preview/assets/frames.js"), "utf8")
  ]);

  assert.match(source, /function renderSafetyWatch\(/);
  assert.match(source, /preview\/guide-video\.html/);
  assert.doesNotMatch(source, /preview\/animatic-video\.html/);
  assert.match(source, /clinical review bypassed/i);
  assert.match(source, /private review/i);
  assert.match(source, /if \(mode === "watch"\) \{\s*renderSafetyWatch\(\);/);
  assert.match(styles, /\.safety-watch-frame/);
  assert.match(styles, /\.watch-experience--safety/);
  assert.match(html, /Loading the recovery guide/);
  assert.match(guideHtml, /Dr\. Hoots guided recovery video/);
  assert.match(guideHtml, /Play the guide/);
  assert.match(playerSource, /get\("embed"\) === "1"/);
  assert.match(playerSource, /host-welcome-canon\.mp4/);
  assert.match(playerSource, /host-healing-canon\.mp4/);
  assert.match(playerSource, /host-follow-up-canon\.mp4/);
  assert.match(frameSource, /frame-01-art-grounded-v2\.png/);
  assert.match(frameSource, /textCard:/);
  assert.match(playerStyles, /html\[data-embed="true"\]/);
});
