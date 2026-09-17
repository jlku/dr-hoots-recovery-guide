import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("the guide is one page with a chapter rail, one player, and a transcript", async () => {
  const html = await read("guide/index.html");
  for (const id of ["guide-title", "language", "print-link", "chapter-list", "call-block", "stage", "caption-band", "caption", "audio", "play-toggle", "scrubber", "scrubber-ticks", "time", "speed", "captions-toggle", "transcript", "follow-toggle", "chapter-bar", "chapter-prev", "chapter-next", "chapter-select", "status"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.equal((html.match(/<audio /g) ?? []).length, 1);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Private prototype\. Not for patient use\./);
  assert.match(html, /<script type="module" src="assets\/guide\.js">/);
  assert.doesNotMatch(html, /autoplay/);
  assert.doesNotMatch(html, /scene\//);
  assert.doesNotMatch(html, /class="eyebrow"/);
  assert.doesNotMatch(html, /watch\.html/);
});

test("the old two-page surface is gone", async () => {
  for (const path of ["guide/watch.html", "guide/assets/toc.js", "guide/assets/player.js"]) {
    await assert.rejects(access(resolve(root, path)), path);
  }
});

test("the stylesheet lays the rail, player, and transcript side by side and stacks them on phones", async () => {
  const css = await read("guide/assets/guide.css");
  assert.match(css, /\.guide-layout\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /\.caption-band\s*\{[^}]*min-height:/s);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /--teal:\s*#14828c/);
  assert.match(css, /:focus-visible/);
});
