import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { applyRunEvent, persistRunRevision, validateRunState } from "./lib/production-run.mjs";

const [runId, receiptPath] = process.argv.slice(2);
if (!/^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/.test(runId ?? "") || !receiptPath) throw new Error("usage: request-activation-export-repair.mjs RUN_ID RECEIPT_PATH");
const stateRoot = resolve(".production/activation");
const runRoot = join(stateRoot, "runs", runId);
const receipt = JSON.parse(await readFile(resolve(receiptPath), "utf8"));
if (receipt.schema_version !== "activation-finished-review/v1" || receipt.role !== "independent_designer" || receipt.disposition !== "revise" || !receipt.critical_failures?.length || receipt.patient_ready !== false) throw new Error("repair receipt is invalid");
const pointer = JSON.parse(await readFile(join(runRoot, "current.json"), "utf8"));
let run = JSON.parse(await readFile(join(runRoot, "revisions", pointer.revision_id.slice(9) + ".json"), "utf8"));
validateRunState(run);
run = applyRunEvent(run, "export_repair_required");
const persistence = await persistRunRevision(stateRoot, run);
process.stdout.write(JSON.stringify({ revision_id: persistence.revision_id, stage: run.stage, status: run.status, reason_code: run.reason_code, review_failure_recorded: true, patient_ready: false }, null, 2) + "\n");
