import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

async function sources() {
  const [html, script, styles] = await Promise.all([
    readFile(resolve(root, "preview/animatic-scroll.html"), "utf8"),
    readFile(resolve(root, "preview/assets/animatic-scroll.js"), "utf8"),
    readFile(resolve(root, "preview/assets/animatic-scroll.css"), "utf8")
  ]);
  return { html, script, styles };
}

test("the reset prototype renders exactly three representative safety cards", async () => {
  const { script } = await sources();

  assert.match(script, /wound-dressing/);
  assert.match(script, /call-redness/);
  assert.match(script, /act-programming/);
  assert.match(script, /CARD_IDS/);
  assert.equal((script.match(/renderFrame\(frame\)/g) ?? []).length, 1);
});

test("scroll pacing uses native scrolling and pixel geometry derived from the viewport", async () => {
  const { script, styles } = await sources();

  assert.match(script, /window\.innerHeight/);
  assert.match(script, /--beat-distance/);
  assert.match(script, /--trigger-offset/);
  assert.match(styles, /var\(--beat-distance/);
  assert.match(styles, /position: sticky/);
  assert.doesNotMatch(script, /preventDefault\(\)|addEventListener\(["']wheel/);
  assert.doesNotMatch(styles, /\d+(?:\.\d+)?vh/);
});

test("only the featured card is bright while adjacent cards remain dark", async () => {
  const { html, script, styles } = await sources();

  assert.match(styles, /\.deck-card \{[^}]*brightness\(\.13\)/s);
  assert.match(styles, /\.deck-card\.is-active \{[^}]*brightness\(1\)/s);
  assert.doesNotMatch(styles, /\.card-focus/);
  assert.match(script, /querySelector\("\.sc-num"\)\?\.remove\(\)/);
  assert.match(html, /Scroll to continue/);
  assert.match(styles, /@keyframes scroll-cue/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("the prototype links a downloadable PDF and has a complete print treatment", async () => {
  const { html, styles } = await sources();

  assert.match(html, /airline-safety-card-deck-prototype\.pdf/);
  assert.match(html, /\bdownload\b/);
  assert.match(styles, /@media print/);
  assert.match(styles, /@page \{ size: letter landscape/);
});
