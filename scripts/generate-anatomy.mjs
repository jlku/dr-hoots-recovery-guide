// scripts/generate-anatomy.mjs
// One attempt per run; --review sends the candidate to the API evaluator afterwards. Reserves the estimate in the ledger first, refuses without FAL_KEY,
// retains the raw PNG, and records hash, prompt, seed, and request id in the manifest.
import { fal } from "@fal-ai/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MANIFEST_PATH, loadContracts, loadManifest, planAttempt, recordCandidate } from "./lib/anatomy.mjs";
import { loadLedger, reserveSpend, saveLedger, settleSpend } from "./lib/spend-ledger.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const assetIndex = args.indexOf("--asset");
const assetId = assetIndex >= 0 ? args[assetIndex + 1] : null;
if (!assetId) throw new Error("--asset <id> is required");

const contracts = await loadContracts(root);
const manifest = await loadManifest(root);
const plan = planAttempt({ contracts, manifest, assetId });
console.log(JSON.stringify({ asset: plan.assetId, attempt: plan.attempt, model: plan.model, image_size: plan.input.image_size, seed: plan.input.seed, estimate_usd: plan.estimateUsd, parent: plan.parentFile, references: (plan.references ?? []).map((reference) => reference.file), file: plan.file }, null, 2));
if (dryRun) {
  console.log("dry run: no request, no spend");
  process.exit(0);
}
if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing; run with --env-file pointing at the ignored .env.local");
fal.config({ credentials: process.env.FAL_KEY });

// A failed reservation keeps its entry; a retry of the same attempt gets a suffixed id.
const existing = await loadLedger(root);
let ledgerId = plan.ledgerId;
for (let retry = 2; (existing.entries ?? []).some((entry) => entry.id === ledgerId); retry += 1) ledgerId = `${plan.ledgerId}-r${retry}`;
plan.ledgerId = ledgerId;
let ledger = reserveSpend(existing, {
  id: plan.ledgerId,
  model: plan.model,
  purpose: `anatomy ${plan.assetId} attempt ${plan.attempt}`,
  units: { image_size: plan.input.image_size, parent: plan.parentFile, references: (plan.references ?? []).length },
  estimate_usd: plan.estimateUsd
});
await saveLedger(root, ledger);

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
async function uploadImage(file) {
  const bytes = await readFile(join(root, file));
  const type = MIME[extname(file).toLowerCase()];
  if (!type) throw new Error(`unsupported reference type ${file}`);
  return { url: await fal.storage.upload(new File([bytes], basename(file), { type })), sha256: createHash("sha256").update(bytes).digest("hex") };
}

const input = { ...plan.input };
const uploads = [];
if (plan.parentFile) uploads.push(await uploadImage(plan.parentFile));
const referenceUploads = [];
for (const reference of plan.references ?? []) {
  const upload = await uploadImage(reference.file);
  referenceUploads.push({ file: reference.file, sha256: upload.sha256, source: reference.source ?? null, license: reference.license ?? null, role: reference.role ?? null });
  uploads.push(upload);
}
if (uploads.length) input.image_urls = uploads.map((upload) => upload.url);

let result;
try {
  result = await fal.subscribe(plan.model, { input, logs: false });
} catch (error) {
  await saveLedger(root, settleSpend(ledger, plan.ledgerId, { status: "failed" }));
  throw error;
}
const image = result.data?.images?.[0];
if (!image?.url) {
  await saveLedger(root, settleSpend(ledger, plan.ledgerId, { status: "failed", requestId: result.requestId ?? null }));
  throw new Error("the provider returned no image");
}
const response = await fetch(image.url);
if (!response.ok) throw new Error(`download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
await mkdir(join(root, "assets/anatomy"), { recursive: true });
await writeFile(join(root, plan.file), bytes);
const next = recordCandidate(manifest, plan, { bytes, width: image.width, height: image.height, requestId: result.requestId ?? null, seed: result.data.seed ?? plan.input.seed, references: referenceUploads });
await writeFile(join(root, MANIFEST_PATH), `${JSON.stringify(next, null, 2)}\n`);
await saveLedger(root, settleSpend(ledger, plan.ledgerId, { status: "completed", requestId: result.requestId ?? null }));
console.log(`saved ${plan.file} (${image.width}x${image.height}) request ${result.requestId}`);

// --review: send the new candidate straight to the API evaluator and accept it if it passes.
if (args.includes("--review")) {
  const { reviewAndRecord } = await import("./lib/review-runner.mjs");
  const recordId = `${plan.assetId}-a${plan.attempt}`;
  const outcome = await reviewAndRecord({ root, selection: { record: recordId }, apply: true, log: (line) => console.log(line) });
  console.log(`review of ${recordId}: ${outcome.verdict}. ${outcome.receipt.adjudication.reason} Cost $${outcome.cost.toFixed(4)}; receipt ${outcome.path}`);
}
