// tests/v2-anatomy.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { IMAGE_SIZES, acceptedRecord, loadContracts, planAttempt, recordCandidate, setStatus, validateAnatomy, validateContracts } from "../scripts/lib/anatomy.mjs";
import { loadFrameManifest } from "../scripts/lib/frames.mjs";

const root = resolve(import.meta.dirname, "..");
const contracts = await loadContracts(root);
const emptyManifest = { schema_version: "1.0", patient_use: false, records: [] };

test("the repository contracts are valid and every edit names an existing parent", () => {
  assert.deepEqual(validateContracts(contracts).errors, []);
  assert.ok(contracts.assets.length >= 5);
  const byId = new Map(contracts.assets.map((item) => [item.id, item]));
  for (const asset of contracts.assets.filter((item) => item.kind === "edit")) {
    let parent = byId.get(asset.parent);
    let depth = 0;
    while (parent && parent.kind === "edit" && depth < 3) {
      parent = byId.get(parent.parent);
      depth += 1;
    }
    assert.ok(parent && parent.kind === "master", `${asset.id} must chain to a master within three edits`);
  }
});

test("attempt plans price the request, lock the seed per attempt, and refuse past the cap", () => {
  const plan = planAttempt({ contracts, manifest: emptyManifest, assetId: "postauricular-base" });
  assert.equal(plan.attempt, 1);
  assert.equal(plan.model, "fal-ai/flux-2-pro");
  assert.equal(plan.input.image_size, "landscape_4_3");
  assert.equal(plan.input.output_format, "png");
  assert.equal(plan.estimateUsd, 0.03);
  assert.equal(plan.file, "assets/anatomy/postauricular-base-a1.png");
  assert.equal(plan.ledgerId, "anatomy:postauricular-base:a1");
  assert.throws(() => planAttempt({ contracts, manifest: emptyManifest, assetId: "postauricular-dressing" }), /needs an accepted postauricular-base/);
  let manifest = emptyManifest;
  const asset = contracts.assets.find((item) => item.id === "postauricular-base");
  for (let attempt = 1; attempt <= asset.max_attempts; attempt += 1) {
    const next = planAttempt({ contracts, manifest, assetId: "postauricular-base" });
    assert.equal(next.input.seed, asset.seed + attempt - 1);
    manifest = recordCandidate(manifest, next, { bytes: Buffer.from(`img${attempt}`), width: 1024, height: 768, requestId: `req-${attempt}`, seed: next.input.seed });
  }
  assert.throws(() => planAttempt({ contracts, manifest, assetId: "postauricular-base" }), /attempt cap/);
  manifest = setStatus(manifest, "postauricular-base-a2", "accepted", "clean incision, no marks");
  assert.equal(acceptedRecord(manifest, "postauricular-base").id, "postauricular-base-a2");
  assert.throws(() => setStatus(manifest, "postauricular-base-a1", "accepted"), /already has an accepted record/);
  const edit = planAttempt({ contracts, manifest, assetId: "postauricular-dressing" });
  assert.equal(edit.model, "fal-ai/flux-2-pro/edit");
  assert.equal(edit.parentFile, "assets/anatomy/postauricular-base-a2.png");
  assert.equal(edit.estimateUsd, 0.04);
  assert.throws(() => planAttempt({ contracts, manifest, assetId: "postauricular-base" }), /already has an accepted/);
});

test("contract validation rejects prompts that allow text, missing forbidden readings, and orphan edits", () => {
  const broken = structuredClone(contracts);
  broken.assets[0].prompt = "a head";
  broken.assets[0].claim.forbidden = [];
  broken.assets.push({ id: "orphan", kind: "edit", parent: "nope", image_size: "landscape_4_3", seed: 1, max_attempts: 2, prompt: "x, no text", claim: { sentence_ids: ["wc.01"], forbidden: ["y"] }, observers_must_recover: ["a", "b"] });
  const text = validateContracts(broken).errors.join("\n");
  assert.match(text, /must forbid text/);
  assert.match(text, /claim\.forbidden must list/);
  assert.match(text, /parent nope is not an asset/);
  assert.ok(Object.keys(IMAGE_SIZES).includes("landscape_4_3"));
});

test("anatomy validation ties frames to accepted records with matching hashes", async () => {
  const frames = await loadFrameManifest(root);
  const manifest = { schema_version: "1.0", patient_use: false, records: [{ id: "postauricular-base-a1", asset_id: "postauricular-base", attempt: 1, file: "assets/anatomy/missing.png", sha256: "0".repeat(64), width: 1024, height: 768, status: "accepted" }] };
  const withUse = structuredClone(frames);
  withUse.frames["frame-01"] = { kind: "composite", alt: "x", layers: { base: "assets/anatomy/not-accepted.png" }, anchors: {}, states: [], overlays: [] };
  const result = await validateAnatomy({ contracts, manifest, frames: withUse, root });
  const text = result.errors.join("\n");
  assert.match(text, /assets\/anatomy\/missing\.png is missing/);
  assert.match(text, /frame-01 uses assets\/anatomy\/not-accepted\.png, which is not an accepted anatomy record/);
});

test("accepted records need a passing adjudication and a receipt bound to the file hash", async () => {
  const frames = await loadFrameManifest(root);
  const live = JSON.parse(await readFile(resolve(root, "assets/anatomy/manifest.json"), "utf8"));
  const accepted = live.records.filter((record) => record.status === "accepted");
  assert.ok(accepted.length >= 2);
  for (const record of accepted) {
    assert.equal(record.review.adjudication.verdict, "pass", record.id);
    const receipt = JSON.parse(await readFile(resolve(root, record.review.receipt), "utf8"));
    if (receipt.panels) {
      // A motion is reviewed as a sequence; each panel's record is bound to the receipt by id and hash.
      assert.ok(receipt.panels.some((panel) => panel.record_id === record.id && panel.sha256 === record.sha256), `${record.id} is a panel of ${receipt.record_id}`);
    } else {
      assert.equal(receipt.record_id, record.id);
      assert.equal(receipt.sha256, record.sha256);
    }
    assert.equal(receipt.observers.length, 3);
    assert.equal(receipt.clinician_review.status, "pending");
  }
  const broken = structuredClone(live);
  const target = broken.records.find((record) => record.status === "accepted");
  target.review = { inspection: "looked fine", observers: 0, adjudication: null, receipt: null };
  const result = await validateAnatomy({ contracts, manifest: broken, frames, root });
  const text = result.errors.join("\n");
  assert.match(text, new RegExp(`${target.id}: accepted without a passing adjudication`));
  assert.match(text, new RegExp(`${target.id}: accepted without a review receipt`));
});

test("a required item cannot be an absence, because no observer states one", () => {
  const broken = structuredClone(contracts);
  broken.assets[0].observers_must_recover = [...broken.assets[0].observers_must_recover, "no liquid on the surface"];
  broken.diagrams[0].observers_must_recover = [...broken.diagrams[0].observers_must_recover, "nothing covering the ear"];
  const errors = validateContracts(broken).errors.join("\n");
  assert.match(errors, /"no liquid on the surface" is an absence/);
  assert.match(errors, /"nothing covering the ear" is an absence/);
});
