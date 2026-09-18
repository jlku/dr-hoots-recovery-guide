// scripts/lib/anatomy.mjs
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { estimateFluxUsd } from "./spend-ledger.mjs";

export const CONTRACTS_PATH = "content/anatomy/contracts.json";
export const MANIFEST_PATH = "assets/anatomy/manifest.json";
export const MODELS = Object.freeze({ master: "fal-ai/flux-2-pro", edit: "fal-ai/flux-2-pro/edit" });
export const IMAGE_SIZES = Object.freeze({
  landscape_4_3: { width: 1024, height: 768 },
  square_hd: { width: 1024, height: 1024 },
  portrait_4_3: { width: 768, height: 1024 }
});
export const STATUSES = Object.freeze(["candidate", "accepted", "rejected"]);

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function loadContracts(root) {
  return JSON.parse(await readFile(join(root, CONTRACTS_PATH), "utf8"));
}

export async function loadManifest(root) {
  try {
    return JSON.parse(await readFile(join(root, MANIFEST_PATH), "utf8"));
  } catch {
    return { schema_version: "1.0", notice: "UNVERIFIED CONCEPT ART — NOT FOR PATIENT USE", patient_use: false, records: [] };
  }
}

export function validateContracts(contracts) {
  const errors = [];
  const ids = new Set();
  if (contracts.patient_use !== false) errors.push("patient_use must be false");
  for (const asset of contracts.assets ?? []) {
    if (ids.has(asset.id)) errors.push(`duplicate asset ${asset.id}`);
    ids.add(asset.id);
    if (!["master", "edit"].includes(asset.kind)) errors.push(`${asset.id}: kind must be master or edit`);
    if (asset.kind === "edit" && !asset.parent) errors.push(`${asset.id}: edits need a parent`);
    if (asset.kind === "edit" && asset.parent && !(contracts.assets ?? []).some((item) => item.id === asset.parent)) errors.push(`${asset.id}: parent ${asset.parent} is not an asset`);
    if (asset.model !== MODELS[asset.kind]) errors.push(`${asset.id}: model must be ${MODELS[asset.kind]}`);
    if (!IMAGE_SIZES[asset.image_size]) errors.push(`${asset.id}: unsupported image_size ${asset.image_size}`);
    if (!(Number.isInteger(asset.seed) && asset.seed > 0)) errors.push(`${asset.id}: seed must be a positive integer`);
    if (!(asset.max_attempts >= 1 && asset.max_attempts <= 4)) errors.push(`${asset.id}: max_attempts must be 1 to 4`);
    if (!asset.prompt?.trim()) errors.push(`${asset.id}: prompt is required`);
    else if (!/no text/i.test(asset.prompt)) errors.push(`${asset.id}: prompt must forbid text, labels, captions, and logos`);
    if (!asset.claim?.sentence_ids?.length) errors.push(`${asset.id}: claim.sentence_ids is required`);
    if (!Array.isArray(asset.claim?.forbidden) || asset.claim.forbidden.length === 0) errors.push(`${asset.id}: claim.forbidden must list the wrong readings`);
    if (!Array.isArray(asset.observers_must_recover) || asset.observers_must_recover.length < 2) errors.push(`${asset.id}: observers_must_recover needs at least two items`);
    for (const item of asset.observers_must_recover ?? []) {
      if (/^(no|not|without|nothing)\b/i.test(item.trim())) errors.push(`${asset.id}: "${item}" is an absence, which no observer states; put it in claim.forbidden instead`);
    }
  }
  for (const diagram of contracts.diagrams ?? []) {
    for (const item of diagram.observers_must_recover ?? []) {
      if (/^(no|not|without|nothing)\b/i.test(item.trim())) errors.push(`${diagram.id}: "${item}" is an absence, which no observer states; put it in claim.forbidden instead`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function attemptsFor(manifest, assetId) {
  return (manifest.records ?? []).filter((record) => record.asset_id === assetId);
}

export function acceptedRecord(manifest, assetId) {
  return attemptsFor(manifest, assetId).find((record) => record.status === "accepted") ?? null;
}

export function planAttempt({ contracts, manifest, assetId }) {
  const asset = (contracts.assets ?? []).find((item) => item.id === assetId);
  if (!asset) throw new Error(`unknown asset ${assetId}`);
  const attempts = attemptsFor(manifest, assetId);
  if (attempts.some((record) => record.status === "accepted")) throw new Error(`${assetId} already has an accepted candidate`);
  if (attempts.length >= asset.max_attempts) throw new Error(`${assetId} reached its ${asset.max_attempts} attempt cap`);
  const size = IMAGE_SIZES[asset.image_size];
  const outputMegapixels = (size.width * size.height) / 1e6;
  let parent = null;
  let inputMegapixels = 0;
  if (asset.kind === "edit") {
    parent = acceptedRecord(manifest, asset.parent);
    if (!parent) throw new Error(`${assetId} needs an accepted ${asset.parent} first`);
    inputMegapixels = (parent.width * parent.height) / 1e6;
  }
  const references = (asset.references ?? []).map((reference) => ({ ...reference }));
  for (const reference of references) inputMegapixels += ((reference.width ?? 0) * (reference.height ?? 0)) / 1e6;
  const attempt = attempts.length + 1;
  return {
    assetId,
    attempt,
    model: MODELS[asset.kind],
    parentFile: parent?.file ?? null,
    references,
    input: { prompt: asset.prompt, image_size: asset.image_size, seed: asset.seed + attempt - 1, output_format: "png", enable_safety_checker: true },
    estimateUsd: estimateFluxUsd({ outputMegapixels, inputMegapixels }),
    file: `assets/anatomy/${assetId}-a${attempt}.png`,
    ledgerId: `anatomy:${assetId}:a${attempt}`
  };
}

export function recordCandidate(manifest, plan, { bytes, width, height, requestId, seed, references = [] }) {
  const record = {
    id: `${plan.assetId}-a${plan.attempt}`,
    asset_id: plan.assetId,
    attempt: plan.attempt,
    file: plan.file,
    sha256: sha256(bytes),
    width,
    height,
    model: plan.model,
    prompt: plan.input.prompt,
    seed,
    references,
    request_id: requestId,
    estimate_usd: plan.estimateUsd,
    ledger_entry: plan.ledgerId,
    status: "candidate",
    note: null,
    review: { inspection: null, observers: [], adjudication: null }
  };
  return { ...manifest, records: [...(manifest.records ?? []), record] };
}

export function setStatus(manifest, recordId, status, note = null) {
  if (!STATUSES.includes(status)) throw new Error(`bad status ${status}`);
  const target = (manifest.records ?? []).find((record) => record.id === recordId);
  if (!target) throw new Error(`no record ${recordId}`);
  if (status === "accepted" && manifest.records.some((record) => record.asset_id === target.asset_id && record.status === "accepted" && record.id !== recordId)) {
    throw new Error(`${target.asset_id} already has an accepted record`);
  }
  return { ...manifest, records: manifest.records.map((record) => (record.id === recordId ? { ...record, status, note } : record)) };
}

export async function validateAnatomy({ contracts, manifest, frames, root }) {
  const errors = [...validateContracts(contracts).errors];
  const assetIds = new Set((contracts.assets ?? []).map((asset) => asset.id));
  for (const record of manifest.records ?? []) {
    if (!assetIds.has(record.asset_id)) errors.push(`${record.id}: unknown asset ${record.asset_id}`);
    if (!STATUSES.includes(record.status)) errors.push(`${record.id}: bad status ${record.status}`);
    if (record.status === "rejected") continue;
    try {
      const bytes = await readFile(join(root, record.file));
      if (sha256(bytes) !== record.sha256) errors.push(`${record.id}: ${record.file} does not match its sha256`);
    } catch {
      errors.push(`${record.id}: ${record.file} is missing`);
    }
    if (record.status === "accepted") {
      if (record.review?.adjudication?.verdict !== "pass") errors.push(`${record.id}: accepted without a passing adjudication`);
      const receipt = record.review?.receipt;
      if (!receipt) {
        errors.push(`${record.id}: accepted without a review receipt`);
      } else {
        try {
          const doc = JSON.parse(await readFile(join(root, receipt), "utf8"));
          const direct = doc.record_id === record.id && doc.sha256 === record.sha256;
          const asPanel = (doc.panels ?? []).some((panel) => panel.record_id === record.id && panel.sha256 === record.sha256);
          if (!direct && !asPanel) errors.push(`${record.id}: receipt ${receipt} does not match the record`);
          if (doc.adjudication?.verdict !== "pass") errors.push(`${record.id}: receipt ${receipt} does not record a pass`);
        } catch {
          errors.push(`${record.id}: receipt ${receipt} is missing`);
        }
      }
    }
  }
  for (const id of assetIds) {
    const accepted = attemptsFor(manifest, id).filter((record) => record.status === "accepted");
    if (accepted.length > 1) errors.push(`${id} has ${accepted.length} accepted records`);
  }
  const acceptedFiles = new Set((manifest.records ?? []).filter((record) => record.status === "accepted").map((record) => record.file));
  for (const [frameId, frame] of Object.entries(frames?.frames ?? {})) {
    for (const file of Object.values(frame.layers ?? {})) {
      if (file.startsWith("assets/anatomy/") && !acceptedFiles.has(file)) errors.push(`${frameId} uses ${file}, which is not an accepted anatomy record`);
    }
  }
  return { valid: errors.length === 0, errors };
}
