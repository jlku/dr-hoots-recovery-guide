// tests/v2-song-review.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { buildFiles, buildHash, hashEntries, inBuild } from "../scripts/lib/build-hash.mjs";

const root = resolve(import.meta.dirname, "..");

test("the build covers what the guide serves and leaves out receipts and the ledger", () => {
  for (const path of ["guide/index.html", "content/translations/es/ci-phase0-v0.1.0.json", "assets/captions/v2/index.json", "assets/audio/v2/voices.json", "assets/anatomy/manifest.json", "output/pdf/airline-safety-card-deck-prototype.pdf"]) {
    assert.ok(inBuild(path), path);
  }
  for (const path of ["content/reviews/index.json", "content/reviews/song/abc.json", "content/spend/v2-ledger.json", "scripts/serve.mjs", "tests/x.test.mjs", "docs/PROJECT_STATUS.md"]) {
    assert.ok(!inBuild(path), path);
  }
});

test("the build hash depends on every file's bytes, not on listing order", () => {
  const a = { path: "guide/a.js", sha256: "1".repeat(64) };
  const b = { path: "guide/b.js", sha256: "2".repeat(64) };
  assert.equal(hashEntries([a, b]), hashEntries([b, a]));
  assert.notEqual(hashEntries([a, b]), hashEntries([a, { ...b, sha256: "3".repeat(64) }]));
  assert.notEqual(hashEntries([a, b]), hashEntries([a]));
});

test("the repository's build hash is stable and lists only build files", async () => {
  const files = await buildFiles(root);
  assert.ok(files.includes("guide/index.html"));
  assert.ok(files.every(inBuild));
  const first = await buildHash(root);
  const second = await buildHash(root);
  assert.match(first.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(first, second);
  assert.equal(first.files, files.length);
});
