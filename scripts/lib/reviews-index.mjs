// scripts/lib/reviews-index.mjs
// Builds content/reviews/index.json: the anatomy receipts, and one badge per reviewer that says whether
// its review covers what the guide serves now. A translation badge follows its pack's current hash;
// the Song badge follows the build hash, so any later change to a served file resets it.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { RECEIPTS_DIR, REVIEWS_INDEX } from "./adjudication.mjs";
import { buildHash } from "./build-hash.mjs";
import { SONG_LABEL, songPanelPaths } from "./song-review.mjs";
import { PANEL_SIZE, REVIEWER_LABEL, TRANSLATION_REVIEWERS, packContentHash, panelReceiptPaths } from "./translation-review.mjs";

const ARTIFACT = "ci-phase0-v0.1.0";

async function readPanel(root, paths) {
  const panel = [];
  for (const path of paths) {
    const text = await readFile(join(root, path), "utf8").catch(() => null);
    if (text) panel.push({ path, receipt: JSON.parse(text) });
  }
  return panel;
}

// The target is recorded only when receipts exist for it, so editing a served file does not touch the
// index until someone reviews the new build.
export function badgeFor(label, panel, target) {
  const reviewed = panel.length === PANEL_SIZE && panel.every(({ receipt }) => receipt.verdict === "pass");
  return {
    status: reviewed ? "reviewed" : "not_reviewed",
    label,
    date: reviewed ? panel.map(({ receipt }) => receipt.reviewed_on).sort().at(-1) : null,
    target: panel.length ? target : null,
    receipts: panel.map(({ path }) => path)
  };
}

export async function buildReviewsIndex(root) {
  const anatomy = (await readdir(join(root, RECEIPTS_DIR))).filter((name) => name.endsWith(".json")).sort().map((name) => `${RECEIPTS_DIR}/${name}`);
  const translations = {};
  for (const [reviewer, config] of Object.entries(TRANSLATION_REVIEWERS)) {
    const pack = JSON.parse(await readFile(join(root, `content/translations/${config.language}/${ARTIFACT}.json`), "utf8"));
    const hash = packContentHash(pack);
    translations[config.language] = badgeFor(REVIEWER_LABEL, await readPanel(root, panelReceiptPaths(reviewer, hash)), hash);
  }
  const build = await buildHash(root);
  const song = badgeFor(SONG_LABEL, await readPanel(root, songPanelPaths(build.sha256)), build.sha256);
  return { schema_version: "1.0", patient_use: false, anatomy, badges: { translations, song } };
}

export async function writeReviewsIndex(root) {
  const index = await buildReviewsIndex(root);
  await writeFile(join(root, REVIEWS_INDEX), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
