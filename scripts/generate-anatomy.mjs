// scripts/generate-anatomy.mjs
// One attempt per run. Reserves the estimate in the ledger first, refuses without FAL_KEY,
// retains the raw PNG, and records hash, prompt, seed, and request id in the manifest.
import { fal } from "@fal-ai/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
console.log(JSON.stringify({ asset: plan.assetId, attempt: plan.attempt, model: plan.model, image_size: plan.input.image_size, seed: plan.input.seed, estimate_usd: plan.estimateUsd, parent: plan.parentFile, file: plan.file }, null, 2));
if (dryRun) {
  console.log("dry run: no request, no spend");
  process.exit(0);
}
if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing; run with --env-file pointing at the ignored .env.local");
fal.config({ credentials: process.env.FAL_KEY });

let ledger = reserveSpend(await loadLedger(root), {
  id: plan.ledgerId,
  model: plan.model,
  purpose: `anatomy ${plan.assetId} attempt ${plan.attempt}`,
  units: { image_size: plan.input.image_size, parent: plan.parentFile },
  estimate_usd: plan.estimateUsd
});
await saveLedger(root, ledger);

const input = { ...plan.input };
if (plan.parentFile) {
  const parentBytes = await readFile(join(root, plan.parentFile));
  input.image_urls = [await fal.storage.upload(new File([parentBytes], "parent.png", { type: "image/png" }))];
}

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
const next = recordCandidate(manifest, plan, { bytes, width: image.width, height: image.height, requestId: result.requestId ?? null, seed: result.data.seed ?? plan.input.seed });
await writeFile(join(root, MANIFEST_PATH), `${JSON.stringify(next, null, 2)}\n`);
await saveLedger(root, settleSpend(ledger, plan.ledgerId, { status: "completed", requestId: result.requestId ?? null }));
console.log(`saved ${plan.file} (${image.width}x${image.height}) request ${result.requestId}`);
