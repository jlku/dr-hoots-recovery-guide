import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

async function source() {
  return readFile(resolve(root, "preview/animatic-scroll.html"), "utf8");
}

test("the digital guide contains the complete fourteen-card sequence", async () => {
  const html = await source();
  const cardNumbers = [...html.matchAll(/number:\s*(\d+),/g)].map((match) => Number(match[1]));

  assert.deepEqual(cardNumbers, Array.from({ length: 14 }, (_, index) => index + 1));
  assert.equal((html.match(/image:\s*"assets\/generated\/card-/g) ?? []).length, 13);
  assert.match(html, /number:\s*11,[^}]*contact:\s*true/s);
  assert.match(html, /Card 01 of 14/);
});

test("scroll pacing stays native, reversible, and keyboard accessible", async () => {
  const html = await source();

  assert.match(html, /new IntersectionObserver/);
  assert.match(html, /rootMargin:\s*"-43% 0px -43% 0px"/);
  assert.match(html, /document\.addEventListener\("keydown"/);
  assert.match(html, /scrollIntoView/);
  assert.match(html, /position:\s*sticky/);
  assert.match(html, /function syncActiveToScroll\(\)/);
  assert.match(html, /addEventListener\("scroll", scheduleScrollSync, \{ passive: true \}\)/);
  assert.doesNotMatch(html, /addEventListener\(["']wheel/);
});

test("only the featured card is bright while nearby cards remain dark", async () => {
  const html = await source();

  assert.match(html, /\.safety-card\s*\{[^}]*filter:\s*brightness\(\.14\)/s);
  assert.match(html, /\.safety-card\.is-active\s*\{[^}]*filter:\s*none/s);
  assert.match(html, /\.safety-card\.is-next\s*\{[^}]*brightness\(\.14\)/s);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /Scroll for card 02/);
});

test("large card images load in a bounded window instead of all at once", async () => {
  const html = await source();

  assert.match(html, /<img loading="lazy" decoding="async" data-src="\$\{card\.image\}"/);
  assert.match(html, /function ensureCardImageLoaded\(index\)/);
  assert.match(html, /\[index - 1, index, index \+ 1, index \+ 2\]\.forEach\(ensureCardImageLoaded\)/);
  assert.match(html, /ensureCardImageLoaded\(index\);\s*step\.scrollIntoView/s);
  assert.match(html, /ensureCardImageLoaded\(next\);\s*steps\[next\]\.scrollIntoView/s);
});

test("the guide has a visible heading and links the verified two-sheet PDF", async () => {
  const html = await source();

  assert.match(html, /<h1>Recovery safety cards<\/h1>/);
  assert.match(html, /Scroll through 14 illustrated recovery cards\./);
  assert.match(html, /\.\.\/output\/pdf\/airline-safety-card-deck-prototype\.pdf/);
  assert.match(html, /\bdownload\b/);
});
