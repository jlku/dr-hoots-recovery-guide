// tests/v2-export.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { activeBeat, activeCue, exportChangePoints, fixedSegments } from "../guide/assets/logic.js";

const root = resolve(import.meta.dirname, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

test("only segments with no patient-specific beats or data export", async () => {
  const { segments } = await readJson("content/segments/ci-phase0-v0.1.0.segments.json");
  assert.deepEqual(fixedSegments(segments).map((segment) => segment.number), [1, 3, 4, 5]);
});

test("a still changes only where a beat, a caption, or a spoken word starts", async () => {
  const timeline = await readJson("assets/captions/v2/en/incision-day2.timeline.json");
  const points = exportChangePoints(timeline);
  assert.equal(points[0], 0);
  assert.ok(points.every((point, index) => index === 0 || point > points[index - 1]), "strictly increasing");
  assert.ok(points.every((point) => point < timeline.duration_seconds));
  for (const time of [timeline.title_card.end, ...timeline.beats.map((beat) => beat.start), ...timeline.cues.map((cue) => cue.start), ...timeline.words.map((word) => word.start)]) {
    assert.ok(points.includes(time), `missing ${time}`);
  }
  // Between two change points nothing on the canvas changes.
  for (let index = 0; index < points.length - 1; index += 1) {
    const [a, b] = [points[index], points[index + 1] - 0.001];
    assert.equal(activeBeat(timeline, a)?.id, activeBeat(timeline, b)?.id);
    assert.equal(activeCue(timeline, a)?.id, activeCue(timeline, b)?.id);
  }
});

test("the export page has the title strip, square stage, caption band, and notice, and no prompt fields", async () => {
  const html = await readFile(resolve(root, "guide/export.html"), "utf8");
  for (const id of ["export-number", "export-heading", "export-chip", "stage", "caption", "notice"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /src="assets\/export\.js"/);
  assert.doesNotMatch(html, /prompt|textarea|<input/i);
  const css = await readFile(resolve(root, "guide/assets/guide.css"), "utf8");
  assert.match(css, /\.export \{[^}]*width: 1080px; height: 1920px; padding: 150px 72px 250px;/, "the canvas keeps the top 150 px and bottom 250 px clear");
});
