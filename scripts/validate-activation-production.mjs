import { readFile } from "node:fs/promises";

import { validateActivationProductionContract } from "./lib/activation-production.mjs";

const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

const [
  production,
  canonical,
  sceneSource,
  programmingAdaptation,
  illustrationManifest,
  characterManifest
] = await Promise.all([
  readJson("../content/productions/ci-activation-v0.1.0.json"),
  readJson("../content/canonical/ci-phase0-v0.1.0.json"),
  readJson("../content/scenes/ci-phase0-v0.1.0.scenes.json"),
  readJson("../content/adaptations/activation-programming-v0.1.0.json"),
  readJson("../assets/illustrations/manifest.json"),
  readJson("../assets/character/manifest.json")
]);

const result = validateActivationProductionContract({
  production,
  canonical,
  sceneSource,
  programmingAdaptation,
  illustrationManifest,
  characterManifest
});

console.log(
  `Activation production contract valid: ${result.production_id}@${result.production_version}, ${result.scenes.length} private scenes.`
);
