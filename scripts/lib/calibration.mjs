// scripts/lib/calibration.mjs
// Runs the evaluator over a labeled set and reports how often it agrees with the in-session loop:
// images that loop accepted, a held candidate it failed, negative controls that judge an image
// against the wrong contract, and a re-coding of every in-session receipt's stored observations,
// which measures the coder apart from observer variance.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CALIBRATION_DIR } from "./adjudication.mjs";
import { DEFAULT_CODINGS, DEFAULT_MODEL, EVALUATOR_VERSION } from "./evaluator.mjs";
import { reviewAndRecord } from "./review-runner.mjs";

export const CASES_PATH = `${CALIBRATION_DIR}/cases.json`;
const round = (value, places) => Number(value.toFixed(places));
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export async function planCalibration(root, { images = true, recodes = true, only = null } = {}) {
  const cases = JSON.parse(await readFile(join(root, CASES_PATH), "utf8"));
  const planned = [];
  if (images) {
    for (const item of cases.image_cases ?? []) {
      const selection = item.diagram ? { diagram: item.diagram } : { record: item.record, as: item.as };
      planned.push({ id: item.id, mode: "image", selection, expect: item.expect, expect_strict: item.expect_strict ?? null, why: item.why ?? null });
    }
  }
  if (recodes) {
    const development = new Set(cases.development_cases ?? []);
    for (const path of cases.recode_cases ?? []) {
      const receipt = JSON.parse(await readFile(join(root, path), "utf8"));
      planned.push({ id: `recode-${receipt.record_id}`, mode: "recode", selection: { recode: path }, expect: receipt.adjudication?.verdict ?? null, expect_strict: receipt.adjudication?.verdict_strict ?? null, why: `in-session verdict in ${path}`, development: development.has(path) });
    }
  }
  return planned.filter((row) => !only || row.id === only);
}

// With repeat > 1 every case runs that many times, and a case whose runs disagree is "unsettled":
// it counts as disagreeing, because a verdict that changes between identical runs cannot gate anything.
// Stops at the first error unless keepGoing is set, so a failure that repeats on every case cannot
// spend the budget one case at a time.
export async function runCalibration({ root, client, dryRun = false, model = DEFAULT_MODEL, images = true, recodes = true, only = null, repeat = 1, codings = DEFAULT_CODINGS, keepGoing = false, log = () => {} }) {
  if (!(Number.isInteger(repeat) && repeat >= 1)) throw new Error("repeat must be a whole number of at least 1");
  const planned = await planCalibration(root, { images, recodes, only });
  const ranOn = new Date().toISOString().slice(0, 10);
  let run = `${ranOn}-${model}`;
  for (let suffix = 2; !dryRun && (await exists(join(root, CALIBRATION_DIR, run))); suffix += 1) run = `${ranOn}-${model}-${suffix}`;
  const rows = [];
  let bound = 0;
  let cost = 0;
  for (const row of planned) {
    const outcomes = [];
    let failure = null;
    for (let attempt = 1; attempt <= repeat && !failure; attempt += 1) {
      const out = `${CALIBRATION_DIR}/${run}/${row.id}${repeat > 1 ? `.r${attempt}` : ""}.json`;
      try {
        outcomes.push(await reviewAndRecord({ root, selection: row.selection, out, dryRun, model, codings, client, log }));
      } catch (error) {
        failure = error;
      }
    }
    if (failure) {
      rows.push({ id: row.id, mode: row.mode, expect: row.expect, error: failure.message });
      log(`${row.id}: error: ${failure.message}`);
      if (/spend cap/.test(failure.message) || !keepGoing) break;
      continue;
    }
    if (dryRun) {
      const rowBound = outcomes.reduce((sum, outcome) => sum + outcome.preview.cost_bound_usd, 0);
      bound += rowBound;
      rows.push({ id: row.id, mode: row.mode, expect: row.expect, expect_strict: row.expect_strict, bound_usd: round(rowBound, 2), development: Boolean(row.development) });
      continue;
    }
    const verdicts = outcomes.map((outcome) => outcome.verdict);
    const settled = verdicts.every((verdict) => verdict === verdicts[0]);
    const got = settled ? verdicts[0] : "unsettled";
    const rowCost = outcomes.reduce((sum, outcome) => sum + outcome.cost, 0);
    cost += rowCost;
    rows.push({
      id: row.id,
      mode: row.mode,
      expect: row.expect,
      got,
      agree: got === row.expect,
      verdicts,
      expect_strict: row.expect_strict,
      got_strict: outcomes.map((outcome) => outcome.verdict_strict),
      receipts: outcomes.map((outcome) => outcome.path),
      cost_usd: round(rowCost, 4),
      why: row.why,
      development: Boolean(row.development)
    });
    log(`${row.id}: expected ${row.expect}, got ${verdicts.join("/")}${got === row.expect ? "" : "  <- disagrees"}`);
  }
  const scored = rows.filter((row) => row.got);
  const summarize = (mode) => {
    const subset = scored.filter((row) => row.mode === mode);
    return { agreed: subset.filter((row) => row.agree).length, scored: subset.length };
  };
  const report = {
    run,
    ran_on: ranOn,
    model,
    evaluator_version: EVALUATOR_VERSION,
    dry_run: dryRun,
    agreement: {
      held_out: { agreed: scored.filter((row) => row.agree && !row.development).length, scored: scored.filter((row) => !row.development).length },
      all: { agreed: scored.filter((row) => row.agree).length, scored: scored.length },
      image: summarize("image"),
      recode: summarize("recode"),
      errors: rows.filter((row) => row.error).length,
      unsettled: scored.filter((row) => row.got === "unsettled").length
    },
    repeat,
    codings,
    bound_usd: round(bound, 2),
    cost_usd: round(cost, 4),
    rows
  };
  if (!dryRun) {
    await mkdir(join(root, CALIBRATION_DIR, run), { recursive: true });
    await writeFile(join(root, CALIBRATION_DIR, run, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}
