// scripts/lib/song-review.mjs
// The simulated Song review of a whole build: the packet the reviewer reads, and the rules its receipt
// must meet. The receipt binds to the build hash, so any change to a served file needs a new review.
// Code measures what it can; a reviewer may fail a check the facts pass, never pass one they fail.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { buildHash } from "./build-hash.mjs";
import { PANEL_SIZE } from "./translation-review.mjs";

export const SONG_LABEL = "Simulated Song review (AI), not Song's approval";
export const SONG_DIR = "content/reviews/song";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function songReceiptPath(hash, member = 1) {
  const base = `${SONG_DIR}/${hash.slice(0, 16)}`;
  return member === 1 ? `${base}.json` : `${base}.${member}.json`;
}

export function songPanelPaths(hash) {
  return Array.from({ length: PANEL_SIZE }, (_, index) => songReceiptPath(hash, index + 1));
}

// evidence is facts.json from scripts/song-evidence.mjs; evidenceDir is where its screenshots are.
export async function buildSongPacket({ root, evidence, evidenceDir }) {
  const [rubricText, persona, build] = await Promise.all([
    readFile(join(root, "reviewers/song/rubric.json"), "utf8"),
    readFile(join(root, "reviewers/song/persona.md"), "utf8"),
    buildHash(root)
  ]);
  if (evidence.build?.sha256 !== build.sha256) {
    throw new Error(`the evidence was captured from build ${String(evidence.build?.sha256).slice(0, 16)}, but the build is now ${build.sha256.slice(0, 16)}; capture it again`);
  }
  const rubric = JSON.parse(rubricText);
  const screenshots = [];
  for (const shot of evidence.screenshots ?? []) {
    const path = join(evidenceDir, shot.file);
    screenshots.push({ path, sha256: sha256(await readFile(path)), shows: shot.shows });
  }
  return {
    reviewer: "song",
    persona,
    target: { kind: "build", sha256: build.sha256, files: build.files },
    rubric: { id: rubric.id, sha256: sha256(rubricText), checks: rubric.checks, verdict_rule: rubric.verdict_rule },
    facts: evidence.checks,
    screenshots,
    receipt_format: {
      schema_version: "1.0",
      reviewer: "song",
      kind: "ai",
      label: SONG_LABEL,
      model: "<the model you are>",
      reviewed_on: "<YYYY-MM-DD>",
      target: "<copy the packet's target object exactly>",
      rubric: "<an object with the packet rubric's id and sha256, copied exactly>",
      checks: "[{ id, verdict: pass|fail, note }] for every rubric check, in rubric order; the note says what you saw",
      findings: "[{ id, problem, evidence }] for every failing check; evidence names the fact or the screenshot",
      verdict: "pass only when every check passes, otherwise fail"
    }
  };
}

export function validateSongReceipt(receipt, packet) {
  const errors = [];
  if (receipt?.reviewer !== "song") errors.push("receipt reviewer must be song");
  if (receipt?.kind !== "ai") errors.push("receipt kind must be ai");
  if (receipt?.label !== SONG_LABEL) errors.push(`receipt label must be "${SONG_LABEL}"`);
  if (!receipt?.model) errors.push("receipt needs the reviewing model");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receipt?.reviewed_on ?? "")) errors.push("receipt needs reviewed_on as YYYY-MM-DD");
  if (receipt?.target?.kind !== "build" || receipt?.target?.sha256 !== packet.target.sha256) errors.push("receipt does not bind to the current build; review the build again");
  if (receipt?.rubric?.id !== packet.rubric.id || receipt?.rubric?.sha256 !== packet.rubric.sha256) errors.push("receipt does not use the current rubric");
  const checks = Array.isArray(receipt?.checks) ? receipt.checks : [];
  const byId = new Map(checks.map((check) => [check.id, check]));
  if (byId.size !== checks.length) errors.push("receipt judges a check twice");
  const failing = [];
  for (const { id } of packet.rubric.checks) {
    const check = byId.get(id);
    if (!check) {
      errors.push(`receipt does not judge ${id}`);
      continue;
    }
    if (!["pass", "fail"].includes(check.verdict)) errors.push(`check ${id} needs a verdict of pass or fail`);
    if (!check.note) errors.push(`check ${id} needs a note saying what was seen`);
    if (check.verdict === "pass" && packet.facts?.[id]?.ok === false) errors.push(`check ${id} passes although its measured fact failed`);
    if (check.verdict === "fail") failing.push(id);
  }
  for (const id of byId.keys()) if (!packet.rubric.checks.some((check) => check.id === id)) errors.push(`receipt judges unknown check ${id}`);
  const expected = failing.length || errors.some((error) => error.includes("needs a verdict")) ? "fail" : "pass";
  if (receipt?.verdict !== expected) errors.push(`receipt verdict must be ${expected}`);
  for (const id of failing) {
    if (!(receipt?.findings ?? []).some((finding) => finding.id === id)) errors.push(`failing check ${id} needs a finding`);
  }
  return errors;
}

export function songPanelErrors(receipts, packet) {
  const errors = [];
  if (receipts.length < PANEL_SIZE) errors.push(`the build needs ${PANEL_SIZE} independent passing Song reviews; ${receipts.length} recorded`);
  receipts.forEach((receipt, index) => {
    errors.push(...validateSongReceipt(receipt, packet).map((error) => `reviewer ${index + 1}: ${error}`));
    if (receipt?.verdict !== "pass") errors.push(`reviewer ${index + 1} failed the build`);
  });
  return errors;
}
