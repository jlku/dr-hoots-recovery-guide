// tests/v2-song-review.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { buildFiles, buildHash, hashEntries, inBuild } from "../scripts/lib/build-hash.mjs";
import { SONG_LABEL, buildSongPacket, songPanelErrors, songPanelPaths, validateSongReceipt } from "../scripts/lib/song-review.mjs";

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

const rubric = JSON.parse(readFileSync(resolve(root, "reviewers/song/rubric.json"), "utf8"));

function packet(facts = {}) {
  return {
    reviewer: "song",
    target: { kind: "build", sha256: "a".repeat(64), files: 3 },
    rubric: { id: rubric.id, sha256: "b".repeat(64), checks: rubric.checks },
    facts: Object.fromEntries(rubric.checks.map((check) => [check.id, { ok: true, ...facts[check.id] }]))
  };
}

function receipt(p, verdicts = {}) {
  const checks = p.rubric.checks.map(({ id }) => ({ id, verdict: verdicts[id] ?? "pass", note: "seen" }));
  const failing = checks.filter((check) => check.verdict === "fail");
  return {
    schema_version: "1.0",
    reviewer: "song",
    kind: "ai",
    label: SONG_LABEL,
    model: "claude-opus-5 (session subagent)",
    reviewed_on: "2026-09-19",
    target: p.target,
    rubric: { id: p.rubric.id, sha256: p.rubric.sha256 },
    checks,
    findings: failing.map(({ id }) => ({ id, problem: "p", evidence: "e" })),
    verdict: failing.length ? "fail" : "pass"
  };
}

test("the Song rubric covers Song's seven requests and the workflow checks", () => {
  assert.deepEqual(rubric.checks.map((check) => check.id), ["short_clips", "no_owl", "narrator", "subtitles", "toc", "languages", "provider_file", "review_line", "card_summary"]);
  assert.ok(rubric.checks.every((check) => check.asked && check.question));
  assert.equal(SONG_LABEL, "Simulated Song review (AI), not Song's approval");
});

test("a Song receipt binds to the build, judges every check, and cannot pass a check its facts fail", () => {
  const p = packet();
  assert.deepEqual(validateSongReceipt(receipt(p), p), []);
  const stale = { ...receipt(p), target: { ...p.target, sha256: "c".repeat(64) } };
  assert.match(validateSongReceipt(stale, p).join("\n"), /does not bind to the current build/);
  const missing = receipt(p);
  missing.checks = missing.checks.filter((check) => check.id !== "toc");
  assert.match(validateSongReceipt(missing, p).join("\n"), /does not judge toc/);
  const unlabeled = { ...receipt(p), label: "Song approved" };
  assert.match(validateSongReceipt(unlabeled, p).join("\n"), /label must be/);
  const factFailed = packet({ subtitles: { ok: false } });
  assert.match(validateSongReceipt(receipt(factFailed), factFailed).join("\n"), /check subtitles passes although its measured fact failed/);
  assert.deepEqual(validateSongReceipt(receipt(factFailed, { subtitles: "fail" }), factFailed), [], "failing a failed fact is valid evidence");
  const judgedWorse = receipt(p, { card_summary: "fail" });
  assert.deepEqual(validateSongReceipt(judgedWorse, p), [], "a reviewer may fail a check whose facts passed");
  const wrongVerdict = { ...receipt(p, { toc: "fail" }), verdict: "pass" };
  assert.match(validateSongReceipt(wrongVerdict, p).join("\n"), /verdict must be fail/);
  const noFinding = { ...receipt(p, { toc: "fail" }), findings: [] };
  assert.match(validateSongReceipt(noFinding, p).join("\n"), /failing check toc needs a finding/);
});

test("a build counts as reviewed only when three independent Song reviews pass it", () => {
  const p = packet();
  const base = `content/reviews/song/${"a".repeat(16)}`;
  assert.deepEqual(songPanelPaths(p.target.sha256), [`${base}.json`, `${base}.2.json`, `${base}.3.json`]);
  assert.deepEqual(songPanelErrors([receipt(p), receipt(p), receipt(p)], p), []);
  assert.match(songPanelErrors([receipt(p), receipt(p)], p).join("\n"), /needs 3 independent passing Song reviews; 2 recorded/);
  assert.match(songPanelErrors([receipt(p), receipt(p, { toc: "fail" }), receipt(p)], p).join("\n"), /reviewer 2 failed the build/);
});

test("a packet refuses evidence captured from a different build", async () => {
  await assert.rejects(buildSongPacket({ root, evidence: { build: { sha256: "0".repeat(64) }, checks: {}, screenshots: [] }, evidenceDir: root }), /captured from build 0000000000000000/);
});
