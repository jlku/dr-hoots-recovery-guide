import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateLanguagePack } from "./lib/language-packs.mjs";
import { loadSegmentBundle } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function loadLanguagePacks(root, artifactFile = "ci-phase0-v0.1.0.json") {
  const base = join(root, "content/translations");
  const entries = await readdir(base, { withFileTypes: true });
  const languages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const packs = [];
  for (const language of languages) {
    const path = `content/translations/${language}/${artifactFile}`;
    packs.push({ language, path, pack: JSON.parse(await readFile(join(root, path), "utf8")) });
  }
  return packs;
}

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
