import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLanguagePacks, validateLanguagePack } from "./lib/language-packs.mjs";
import { buildPacket, panelErrors, panelReceiptPaths, reviewerForLanguage } from "./lib/translation-review.mjs";
import { loadSegmentBundle } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const bundle = await loadSegmentBundle(repositoryRoot);
  const packs = await loadLanguagePacks(repositoryRoot);
  const english = packs.find((entry) => entry.pack.language === "en")?.pack;
  if (!english) {
    console.error("error: the English pack content/translations/en is required");
    process.exit(1);
  }
  let failed = false;
  for (const { language, path, pack } of packs) {
    const errors = [...validateLanguagePack({ pack, canonical: bundle.canonical, segments: bundle.segments, source: english }).errors];
    if (pack.language !== language) errors.push(`language ${pack.language} does not match directory ${language}`);
    // An AI-reviewed pack needs a full panel of passing receipts bound to exactly these sentences and
    // labels, and its review block lists them.
    if (pack.status === "ai_reviewed") {
      const reviewer = reviewerForLanguage(pack.language);
      const packet = await buildPacket({ root: repositoryRoot, reviewer });
      const paths = panelReceiptPaths(reviewer, packet.target.sha256);
      const receipts = [];
      for (const path of paths) {
        const text = await readFile(join(repositoryRoot, path), "utf8").catch(() => null);
        if (text) receipts.push(JSON.parse(text));
      }
      errors.push(...panelErrors(receipts, packet).map((error) => `review: ${error}`));
      if (JSON.stringify(pack.review?.receipts) !== JSON.stringify(paths)) errors.push(`review: receipts must list ${paths.join(", ")}`);
    }
    if (errors.length) {
      failed = true;
      for (const error of errors) console.error(`error: ${path}: ${error}`);
    } else {
      console.log(`${path}: valid (${pack.language}, ${pack.status})`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
