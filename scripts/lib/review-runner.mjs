// scripts/lib/review-runner.mjs
// Everything around one API review that touches files: resolving what to review and against which
// contract, loading and checking the image, writing the receipt, keeping the reviews index and the
// manifest in step, and saving the ledger before the first call and after the last.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import { RECEIPTS_DIR, REVIEWS_INDEX } from "./adjudication.mjs";
import { MANIFEST_PATH, loadContracts, loadManifest, setStatus } from "./anatomy.mjs";
import { API_BASE_URL, DEFAULT_CODINGS, DEFAULT_MODEL, EVALUATOR_VERSION, loadPrompts, observerRequest, parseObservation, reviewContract, reviewCostBound, runReview } from "./evaluator.mjs";
import { ledgerTotals, loadLedger, saveLedger } from "./spend-ledger.mjs";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES = Object.freeze({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" });

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

// The desktop app sets ANTHROPIC_BASE_URL for its own traffic. The evaluator always talks to the
// public API with the user's own key, unless AVS_ANTHROPIC_BASE_URL names a gateway on purpose.
export function createClient(env = process.env) {
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("ANTHROPIC_API_KEY is missing. Add it to the ignored .env.local and run with --env-file=.env.local, or pass --dry-run to see the requests without sending them.");
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY ?? null, authToken: env.ANTHROPIC_AUTH_TOKEN ?? null, baseURL: env.AVS_ANTHROPIC_BASE_URL || API_BASE_URL });
}

export async function loadImage(root, file) {
  const bytes = await readFile(join(root, file));
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${file} is ${bytes.length} bytes; the API takes images up to 5 MB, so downscale it first`);
  const mediaType = MEDIA_TYPES[extname(file).toLowerCase()];
  if (!mediaType) throw new Error(`${file}: only PNG, JPEG, and WebP images can be reviewed`);
  const isPng = mediaType === "image/png" && bytes.length > 24 && bytes.toString("ascii", 12, 16) === "IHDR";
  const size = isPng ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : { width: 2576, height: 2576 };
  return { file, bytes: bytes.length, mediaType, base64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), ...size };
}

export async function resolveSelection(root, { record: recordId, diagram: diagramId, recode, as } = {}) {
  const contracts = await loadContracts(root);
  const manifest = await loadManifest(root);
  const assetContract = (id) => {
    const asset = (contracts.assets ?? []).find((item) => item.id === id);
    if (!asset) throw new Error(`there is no asset contract ${id}`);
    return reviewContract(asset, { kind: "asset" });
  };
  if (recordId) {
    const record = (manifest.records ?? []).find((item) => item.id === recordId);
    if (!record) throw new Error(`there is no manifest record ${recordId}`);
    if (record.status === "rejected") throw new Error(`${recordId} was rejected and its file removed`);
    const image = await loadImage(root, record.file);
    if (image.sha256 !== record.sha256) throw new Error(`${record.file} does not match the sha256 recorded for ${recordId}`);
    return {
      target: { id: as ? `${recordId}-as-${as}` : recordId, kind: "record", record_id: recordId, file: record.file, sha256: image.sha256 },
      contract: assetContract(as ?? record.asset_id),
      image,
      record,
      control: Boolean(as)
    };
  }
  if (diagramId) {
    if (as) throw new Error("--as applies to a record, not a diagram");
    const diagram = (contracts.diagrams ?? []).find((item) => item.id === diagramId);
    if (!diagram) throw new Error(`there is no diagram contract ${diagramId}`);
    const image = await loadImage(root, diagram.file);
    const panels = (diagram.panels ?? []).map((id) => {
      const panel = (manifest.records ?? []).find((item) => item.id === id);
      if (!panel) throw new Error(`${diagramId} names panel ${id}, which is not in the manifest`);
      return { record_id: id, file: panel.file, sha256: panel.sha256 };
    });
    return { target: { id: diagramId, kind: "diagram", file: diagram.file, sha256: image.sha256, panels }, contract: reviewContract(diagram, { kind: "diagram" }), image, control: false };
  }
  if (recode) {
    const receipt = JSON.parse(await readFile(join(root, recode), "utf8"));
    const diagram = (contracts.diagrams ?? []).find((item) => item.id === receipt.record_id);
    const contract = diagram ? reviewContract(diagram, { kind: "diagram" }) : assetContract(receipt.contract_id ?? receipt.asset_id);
    const observations = (receipt.observers ?? []).map((observer, index) => ({ number: index + 1, answers: observer.answers ?? parseObservation(observer.observation) }));
    if (observations.length !== 3) throw new Error(`${recode} does not hold three observations`);
    return {
      target: { id: `recode-${receipt.record_id}`, kind: "recode", record_id: receipt.record_id, recoded_from: recode, file: receipt.file ?? null, sha256: receipt.sha256 ?? null, panels: receipt.panels ?? null },
      contract,
      image: null,
      observations,
      control: false
    };
  }
  throw new Error("choose what to review: --record <manifest record>, --diagram <diagram id>, or --recode <receipt>");
}

// The evaluator lists its own receipts and leaves the badges as they are; `npm run check` says when
// they need rebuilding with `npm run reviews:index`.
export async function refreshReviewsIndex(root) {
  const names = (await readdir(join(root, RECEIPTS_DIR))).filter((name) => name.endsWith(".json")).sort();
  const current = await readFile(join(root, REVIEWS_INDEX), "utf8").then(JSON.parse, () => ({}));
  const index = { schema_version: "1.0", patient_use: false, ...current, anatomy: names.map((name) => `${RECEIPTS_DIR}/${name}`) };
  await writeFile(join(root, REVIEWS_INDEX), `${JSON.stringify(index, null, 2)}\n`);
}

const redact = (params) => ({
  ...params,
  messages: params.messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content) ? message.content.map((block) => (block.type === "image" ? { type: "image", source: { type: "base64", media_type: block.source.media_type, data: `[${block.source.data.length} base64 characters]` } } : block)) : message.content
  }))
});

export async function reviewAndRecord({ root, selection, out, force = false, apply = false, dryRun = false, model = DEFAULT_MODEL, codings = DEFAULT_CODINGS, client, log = () => {} }) {
  const resolved = await resolveSelection(root, selection);
  const defaultOut = `${RECEIPTS_DIR}/${resolved.target.id}.json`;
  if ((resolved.control || resolved.target.kind === "recode") && !out) throw new Error("a negative control or a re-coding must be written with --out, so it never replaces a real receipt");
  const receiptPath = out ?? defaultOut;
  const prompts = await loadPrompts(root);
  const ledger = await loadLedger(root);
  const observe = !resolved.observations;
  const bound = reviewCostBound({ image: resolved.image, model, observe, codings });
  if (dryRun) {
    return {
      dryRun: true,
      preview: {
        target: resolved.target,
        contract: { id: resolved.contract.id, rule: resolved.contract.rule, instruction: resolved.contract.instruction },
        calls: (observe ? 3 : 0) + codings,
        codings,
        model,
        cost_bound_usd: bound,
        ledger_remaining_usd: ledgerTotals(ledger).remaining,
        receipt: receiptPath,
        observer_request: observe ? redact(observerRequest({ image: resolved.image, instruction: resolved.contract.instruction, model, system: prompts.observer })) : null
      }
    };
  }
  if (!force && (await exists(join(root, receiptPath)))) throw new Error(`${receiptPath} already exists; pass --force to replace it, or --out to write elsewhere`);
  const api = client ?? createClient();
  log(`reviewing ${resolved.target.id} against ${resolved.contract.id} (${resolved.contract.rule} rule): ${observe ? "three observers, then " : ""}${codings} codings, at most $${bound.toFixed(2)}`);
  const { receipt, cost } = await runReview({
    client: api,
    contract: resolved.contract,
    image: resolved.image,
    target: resolved.target,
    prompts,
    ledger,
    persistLedger: (next) => saveLedger(root, next),
    model,
    codings,
    observations: resolved.observations ?? null
  });
  await mkdir(dirname(join(root, receiptPath)), { recursive: true });
  await writeFile(join(root, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`);
  if (receiptPath.startsWith(`${RECEIPTS_DIR}/`)) await refreshReviewsIndex(root);
  const { verdict, verdict_strict: verdictStrict, reason } = receipt.adjudication;
  if (resolved.target.kind === "record" && !resolved.control && receiptPath === defaultOut) {
    const manifest = await loadManifest(root);
    const record = manifest.records.find((item) => item.id === resolved.record.id);
    let next = {
      ...manifest,
      records: manifest.records.map((item) =>
        item.id === record.id ? { ...item, review: { inspection: null, observers: 3, adjudication: { verdict, verdict_strict: verdictStrict, unsettled: receipt.adjudication.unsettled, reason }, receipt: receiptPath, evaluator: `api ${EVALUATOR_VERSION}` } } : item
      )
    };
    if (apply && verdict === "pass" && record.status === "candidate") {
      next = setStatus(next, record.id, "accepted", `Accepted by the API evaluator on ${receipt.reviewed_on}. ${reason}`);
      log(`${record.id} accepted`);
    } else if (apply && verdict !== "pass") {
      log(`${record.id} stays ${record.status}: the review failed`);
    } else if (record.status === "accepted" && verdict !== "pass") {
      log(`warning: ${record.id} is accepted but this review failed; npm run check will flag it`);
    }
    await writeFile(join(root, MANIFEST_PATH), `${JSON.stringify(next, null, 2)}\n`);
  }
  return { receipt, path: receiptPath, cost, verdict, verdict_strict: verdictStrict };
}
