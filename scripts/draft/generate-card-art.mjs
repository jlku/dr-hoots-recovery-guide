// Clinical safety-card visuals are deterministic SVGs. Generative models may
// supply neutral human figures elsewhere, but they must not invent medical
// anatomy, locations, thresholds, branch logic, or treatment actions.
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cards = new Map([
  ["frame-01", "preview/assets/cards/frame-01.svg"],
  ["frame-0203", "preview/assets/cards/frame-0203-paths.svg"],
  ["frame-0405", "preview/assets/cards/frame-0405-milestones.svg"],
  ["frame-06", "preview/assets/cards/frame-06-redness.svg"],
  ["frame-0710", "preview/assets/cards/frame-0710-anylist.svg"],
  ["frame-11", "preview/assets/cards/frame-11-numbers.svg"],
  ["frame-recap", "preview/assets/cards/frame-recap.svg"]
]);

const requested = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const targets = requested.length > 0 ? requested : [...cards.keys()];

for (const id of targets) {
  const relativePath = cards.get(id);
  if (!relativePath) throw new Error(`unknown deterministic card: ${id}`);
  await access(path.resolve(projectRoot, relativePath));
  console.log(`${id}\t${relativePath}\tdeterministic_svg`);
}

console.log("No raster generation was performed. Edit the SVG source, render a new review image, and run the safety-card evaluator.");
