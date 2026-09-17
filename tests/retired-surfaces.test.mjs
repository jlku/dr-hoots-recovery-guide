import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

const RETIRED_PATHS = [
  "assets/video",
  "assets/character",
  "assets/fal",
  "preview/assets/media",
  "assets/dr-hoots-clay.png",
  "assets/homepage-mascot-guided-video.png",
  "character-exploration.html",
  "variations.html",
  "assets/variations.css",
  "assets/variations.js",
  "tiktok-video.html",
  "preview/guide-video.html",
  "preview/animatic-video.html",
  "preview/assets/animatic-video.css",
  "preview/assets/animatic-video.js",
  "scripts/generate-fal-host-video.mjs",
  "scripts/generate-fal-assets.mjs",
  "scripts/generate-activation-host.mjs",
  "scripts/lib/production-run.mjs",
  "scripts/lib/provider-boundary.mjs",
  "content/productions"
];

const RETIRED_REFERENCES = /assets\/(video|character|fal)\/|preview\/assets\/media\/|variations\.html|tiktok-video\.html|guide-video\.html|animatic-video\.(html|js|css)|character-exploration\.html/;
const SCANNED = /\.(html|js|mjs|css|json)$/;

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\0").filter(Boolean);
}

test("retired Dr. Hoots surfaces are gone", () => {
  const present = RETIRED_PATHS.filter((path) => existsSync(resolve(root, path)));
  assert.deepEqual(present, []);
});

test("no page, script, style, or manifest references a retired surface", () => {
  const offenders = trackedFiles()
    .filter((path) => SCANNED.test(path) && !path.startsWith("docs/") && path !== "tests/retired-surfaces.test.mjs" && path !== "package-lock.json")
    .filter((path) => RETIRED_REFERENCES.test(readFileSync(resolve(root, path), "utf8")));
  assert.deepEqual(offenders, []);
});
