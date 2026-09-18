// scripts/calibrate-evaluator.mjs
// Checks the API evaluator against the labeled set in content/reviews/calibration/cases.json and
// writes a report beside the receipts it produced. Run with --dry-run first to see what it will cost.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runCalibration } from "./lib/calibration.mjs";
import { DEFAULT_CODINGS, DEFAULT_MODEL } from "./lib/evaluator.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (flag) => args.includes(flag);
if (has("--help")) {
  console.log(`Calibrate the API evaluator against the labeled set.

  npm run review:calibrate -- [--dry-run] [--images-only | --recode-only] [--only <case id>] [--repeat <n>] [--codings <n>] [--model <id>]

  --repeat runs every case n times; a case whose runs disagree is reported as unsettled.`);
  process.exit(0);
}

try {
  const report = await runCalibration({
    root,
    dryRun: has("--dry-run"),
    model: value("--model") ?? DEFAULT_MODEL,
    images: !has("--recode-only"),
    recodes: !has("--images-only"),
    only: value("--only") ?? null,
    repeat: value("--repeat") ? Number(value("--repeat")) : 1,
    codings: value("--codings") ? Number(value("--codings")) : DEFAULT_CODINGS,
    log: (line) => console.log(line)
  });
  if (report.dry_run) {
    console.log(`${report.rows.length} cases, ${report.rows.filter((row) => row.mode === "image").length} with new observers, each run ${report.repeat} time(s). Each reservation is at most $${Math.max(...report.rows.map((row) => row.bound_usd ?? 0)).toFixed(2)}, and it settles to the billed cost before the next case starts.`);
    console.log(`If every call used its whole token ceiling the run would cost $${report.bound_usd.toFixed(2)}; real calls use a fraction of that.`);
    console.log("dry run: no request, no spend");
  } else {
    const { held_out: heldOut, all, image, recode, errors, unsettled } = report.agreement;
    console.log(`agreement on held-out cases: ${heldOut.agreed}/${heldOut.scored}; all cases ${all.agreed}/${all.scored} (new observers ${image.agreed}/${image.scored}, re-coded ${recode.agreed}/${recode.scored}); ${unsettled} unsettled; ${errors} errors; $${report.cost_usd.toFixed(4)}`);
    console.log(`report: content/reviews/calibration/${report.run}/report.json`);
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
