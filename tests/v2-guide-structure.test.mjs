// tests/v2-guide-structure.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("the contents page exposes the language selector, subtitle toggle, list, card link, and review badges", async () => {
  const html = await read("guide/index.html");
  for (const id of ["guide-title", "guide-subtitle", "language", "subtitles-toggle", "segment-list", "card-link", "review-badges", "notice", "fallback-notice"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<html lang="en">/);
  assert.match(html, /output\/pdf\/airline-safety-card-deck-prototype\.pdf/);
  assert.match(html, /Private prototype\. Not for patient use\./);
  assert.match(html, /<script type="module" src="assets\/toc\.js">/);
  assert.doesNotMatch(html, /scene\//);
});

test("the stylesheet fixes the caption band height, honors reduced motion, and keeps a 9:16 canvas", async () => {
  const css = await read("guide/assets/guide.css");
  assert.match(css, /\.caption-band\s*\{[^}]*min-height:/s);
  assert.match(css, /aspect-ratio:\s*9 \/ 16/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /--teal:\s*#14828c/);
  assert.match(css, /:focus-visible/);
});

test("the player page has one audio element, a fixed caption band, transport controls, segment navigation, and a transcript", async () => {
  const html = await read("guide/watch.html");
  assert.equal((html.match(/<audio /g) ?? []).length, 1);
  for (const id of ["title-strip", "stage", "caption-band", "caption", "play-toggle", "scrubber", "time", "speed", "speed-label", "subtitles-toggle", "subtitles-label", "language", "segment-prev", "segment-next", "transcript", "transcript-summary", "status", "contents-link"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<input id="scrubber" class="scrubber" type="range"/);
  assert.match(html, /<option value="1" selected>1×<\/option>/);
  assert.match(html, /Private prototype\. Not for patient use\./);
  assert.match(html, /<script type="module" src="assets\/player\.js">/);
  assert.doesNotMatch(html, /autoplay/);
  assert.doesNotMatch(html, /scene\//);
});
