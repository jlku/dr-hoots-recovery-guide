# AVS v2 Slice 3: Anatomy Masters with Deterministic Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder safety-card SVGs on the anatomy frames with generated anatomy masters that carry no clinical marks, draw every clinical mark as deterministic SVG on the narration clock, put the images through the caption-blind observation loop, and keep every dollar in a ledger under the $10 cap.

**Architecture:** A spend ledger under `content/spend/` gates every provider call. Anatomy assets are contracted in `content/anatomy/contracts.json` (claim, prompt, forbidden readings, attempt cap) and produced by `scripts/generate-anatomy.mjs` into `assets/anatomy/` with a manifest that records hashes, prompts, seeds, request ids, and review state; a validator ties frames to accepted records only. One master (the healed area behind the ear) has three controlled edits (dressing on, red and swollen, fluid under the skin); a second master shows the external processor worn at the programming visit. The frames manifest gains a `composite` kind: image layers that switch on narration phrases plus SVG overlays (tape strip, inset, prohibition, checklist, rows, steps, pointer) that appear on phrases, all labeled from the language pack and mapped to sentence ids. `frames.js` renders composites and `guide.js` drives them by time. Two non-anatomy frames become live-text cards so the disliked SVG cards leave the guide.

**Tech Stack:** Node 22 ES modules, `@fal-ai/client` 1.10 against `fal-ai/flux-2-pro` (text to image) and `fal-ai/flux-2-pro/edit` (controlled edits of our own master), `node:test`, inline SVG, the existing dev server. Reference images are read by the author to write prompts and are never uploaded.

**Spec:** `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md`, sections 5, 9, 10, 12, 13, 14.

## Global Constraints

- Spend cap `$10`, authorized by John on 2026-09-17. Every provider request reserves its estimate in `content/spend/v2-ledger.json` before it runs and settles after; the generator refuses to run past the cap or without `FAL_KEY`. FLUX.2 pro: `$0.03` for the first megapixel, `$0.015` per additional megapixel, input plus output.
- Attempt cap per asset `3` (`4` at most). Rejected files are deleted after review; their records stay with the reason.
- Generated images carry no text, labels, captions, logos, tape, marks, devices before activation, or technique. Every clinical mark is deterministic SVG. On-frame text maps to sentence ids and comes from the language pack.
- The Cleveland Clinic diagram and the postoperative photograph in `evals/safety-cards/references/` inform prompts only; they are not sent to any provider.
- Every asset stays `patient_use: false` with the notice `UNVERIFIED CONCEPT ART — NOT FOR PATIENT USE`. AI observation is never clinical approval; the clinical gate remains the clinician review line.
- Zero changes to slice 1 data, the scroll guide, or `preview/assets/cards`.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

- `content/spend/v2-ledger.json`, `scripts/lib/spend-ledger.mjs`, `scripts/validate-spend.mjs`: the ledger.
- `content/anatomy/contracts.json`: what each asset must show, forbid, and how it is generated.
- `scripts/lib/anatomy.mjs`, `scripts/generate-anatomy.mjs`, `scripts/validate-anatomy.mjs`, `assets/anatomy/manifest.json` and PNGs.
- `reviewers/anatomy/observer.md`, `reviewers/anatomy/adjudicator.md`, `content/reviews/anatomy/<record-id>.json`: the observation loop.
- `content/frames/ci-phase0-v0.1.0.frames.json` (composite frames), `scripts/lib/frames.mjs` (composite validation), `guide/assets/frames.js` (composite renderer, `updateFrame`), `guide/assets/guide.js` (time-driven frames), `guide/assets/guide.css`.
- `content/translations/en/ci-phase0-v0.1.0.json`: overlay label keys `ov.*`.
- Tests: `tests/v2-spend-ledger.test.mjs`, `tests/v2-anatomy.test.mjs`, `tests/v2-frames.test.mjs` (extended), `tests/v2-guide-logic.test.mjs` (phrase timing).

---

### Task 1: Spend ledger

**Files:**
- Create: `content/spend/v2-ledger.json`
- Create: `scripts/lib/spend-ledger.mjs`
- Create: `scripts/validate-spend.mjs`
- Modify: `package.json` (`spend:validate` in `check`)
- Test: `tests/v2-spend-ledger.test.mjs`

**Interfaces:**
- Produces: `LEDGER_PATH`, `PRICING`, `estimateFluxUsd({ outputMegapixels, inputMegapixels })`, `estimateNarrationUsd(characters)`, `ledgerTotals(ledger) -> { cap, committed, remaining, entries }`, `reserveSpend(ledger, { id, model, purpose, units, estimate_usd }) -> ledger`, `settleSpend(ledger, id, { status, requestId, actualUsd }) -> ledger`, `validateLedger(ledger) -> { valid, errors, totals }`, `loadLedger(root)`, `saveLedger(root, ledger)`. Statuses: `reserved`, `completed`, `failed`; only `reserved` and `completed` count against the cap.

- [x] **Step 1: Write the failing test**

```js
// tests/v2-spend-ledger.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { estimateFluxUsd, estimateNarrationUsd, ledgerTotals, loadLedger, reserveSpend, settleSpend, validateLedger } from "../scripts/lib/spend-ledger.mjs";

const root = resolve(import.meta.dirname, "..");

function fixture(cap = 1) {
  return { schema_version: "1.0", cap_usd: cap, authorized_by: "fixture", authorized_on: "2026-09-17", entries: [] };
}

test("estimates round up to the cent from published megapixel and character rates", () => {
  assert.equal(estimateFluxUsd({ outputMegapixels: 0.786 }), 0.03);
  assert.equal(estimateFluxUsd({ outputMegapixels: 1.05 }), 0.04);
  assert.equal(estimateFluxUsd({ outputMegapixels: 0.786, inputMegapixels: 0.786 }), 0.04);
  assert.equal(estimateNarrationUsd(2000), 0.2);
});

test("reservations count against the cap and refuse to cross it", () => {
  let ledger = reserveSpend(fixture(1), { id: "a", model: "fal-ai/flux-2-pro", purpose: "test", estimate_usd: 0.6 });
  assert.equal(ledgerTotals(ledger).committed, 0.6);
  assert.equal(ledgerTotals(ledger).remaining, 0.4);
  assert.throws(() => reserveSpend(ledger, { id: "b", model: "fal-ai/flux-2-pro", purpose: "test", estimate_usd: 0.5 }), /spend cap/);
  ledger = settleSpend(ledger, "a", { status: "failed" });
  assert.equal(ledgerTotals(ledger).committed, 0);
  ledger = reserveSpend(ledger, { id: "b", model: "fal-ai/flux-2-pro", purpose: "test", estimate_usd: 0.5 });
  ledger = settleSpend(ledger, "b", { status: "completed", requestId: "req-1", actualUsd: 0.45 });
  assert.equal(ledgerTotals(ledger).committed, 0.45);
  assert.equal(ledger.entries.at(-1).request_id, "req-1");
  assert.throws(() => settleSpend(ledger, "zzz", { status: "completed" }), /no ledger entry/);
  assert.throws(() => reserveSpend(ledger, { id: "c", model: "x", purpose: "t", estimate_usd: 0 }), /positive/);
});

test("validation catches duplicates, bad statuses, and an overspent ledger", () => {
  const ledger = fixture(0.05);
  ledger.entries.push({ id: "a", status: "completed", estimate_usd: 0.03, actual_usd: null }, { id: "a", status: "completed", estimate_usd: 0.03, actual_usd: null }, { id: "b", status: "weird", estimate_usd: 0.03, actual_usd: null });
  const result = validateLedger(ledger);
  assert.match(result.errors.join("\n"), /duplicate ledger entry a/);
  assert.match(result.errors.join("\n"), /bad status weird/);
  assert.match(result.errors.join("\n"), /exceeds the \$0.05 cap/);
});

test("the repository ledger is valid and capped at ten dollars", async () => {
  const ledger = await loadLedger(root);
  assert.equal(ledger.cap_usd, 10);
  assert.equal(validateLedger(ledger).valid, true);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --test tests/v2-spend-ledger.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/spend-ledger.mjs'`

- [x] **Step 3: Write the ledger file, library, and CLI**

```json
{
  "schema_version": "1.0",
  "cap_usd": 10,
  "authorized_by": "John",
  "authorized_on": "2026-09-17",
  "notice": "Every provider request reserves its estimate here before it runs.",
  "entries": []
}
```

```js
// scripts/lib/spend-ledger.mjs
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LEDGER_PATH = "content/spend/v2-ledger.json";
export const PRICING = Object.freeze({
  verifiedOn: "2026-09-17",
  flux2ProFirstMegapixelUsd: 0.03,
  flux2ProAdditionalMegapixelUsd: 0.015,
  elevenV3PerThousandCharactersUsd: 0.1
});
const COUNTED = new Set(["reserved", "completed"]);
const STATUSES = new Set(["reserved", "completed", "failed"]);
const roundUpCents = (value) => Math.ceil(value * 100 - 1e-9) / 100;
const round = (value) => Number(value.toFixed(2));

export function estimateFluxUsd({ outputMegapixels, inputMegapixels = 0 }) {
  const total = outputMegapixels + inputMegapixels;
  return roundUpCents(PRICING.flux2ProFirstMegapixelUsd + Math.max(0, total - 1) * PRICING.flux2ProAdditionalMegapixelUsd);
}

export function estimateNarrationUsd(characters) {
  return roundUpCents((characters / 1000) * PRICING.elevenV3PerThousandCharactersUsd);
}

export function ledgerTotals(ledger) {
  const counted = (ledger.entries ?? []).filter((entry) => COUNTED.has(entry.status));
  const committed = counted.reduce((sum, entry) => sum + (entry.actual_usd ?? entry.estimate_usd), 0);
  return { cap: ledger.cap_usd, committed: round(committed), remaining: round(ledger.cap_usd - committed), entries: counted.length };
}

export function reserveSpend(ledger, entry) {
  if (!(entry.estimate_usd > 0)) throw new Error("estimate_usd must be positive");
  const totals = ledgerTotals(ledger);
  if (totals.committed + entry.estimate_usd > ledger.cap_usd + 1e-9) {
    throw new Error(`spend cap: $${entry.estimate_usd.toFixed(2)} would exceed the remaining $${totals.remaining.toFixed(2)} of the $${ledger.cap_usd} cap`);
  }
  if ((ledger.entries ?? []).some((existing) => existing.id === entry.id)) throw new Error(`ledger entry ${entry.id} already exists`);
  const record = {
    id: entry.id,
    at: entry.at ?? new Date().toISOString(),
    model: entry.model,
    purpose: entry.purpose,
    units: entry.units ?? {},
    estimate_usd: entry.estimate_usd,
    actual_usd: null,
    request_id: null,
    status: "reserved"
  };
  return { ...ledger, entries: [...(ledger.entries ?? []), record] };
}

export function settleSpend(ledger, id, { status, requestId = null, actualUsd = null }) {
  if (!["completed", "failed"].includes(status)) throw new Error("status must be completed or failed");
  let found = false;
  const entries = (ledger.entries ?? []).map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return { ...entry, status, request_id: requestId, actual_usd: actualUsd };
  });
  if (!found) throw new Error(`no ledger entry ${id}`);
  return { ...ledger, entries };
}

export function validateLedger(ledger) {
  const errors = [];
  if (!(ledger.cap_usd > 0)) errors.push("cap_usd must be positive");
  const ids = new Set();
  for (const entry of ledger.entries ?? []) {
    if (ids.has(entry.id)) errors.push(`duplicate ledger entry ${entry.id}`);
    ids.add(entry.id);
    if (!STATUSES.has(entry.status)) errors.push(`${entry.id}: bad status ${entry.status}`);
    if (!(entry.estimate_usd > 0)) errors.push(`${entry.id}: estimate_usd must be positive`);
  }
  const totals = ledgerTotals(ledger);
  if (totals.committed > ledger.cap_usd + 1e-9) errors.push(`committed $${totals.committed} exceeds the $${ledger.cap_usd} cap`);
  return { valid: errors.length === 0, errors, totals };
}

export async function loadLedger(root) {
  return JSON.parse(await readFile(join(root, LEDGER_PATH), "utf8"));
}

export async function saveLedger(root, ledger) {
  await writeFile(join(root, LEDGER_PATH), `${JSON.stringify(ledger, null, 2)}\n`);
}
```

```js
// scripts/validate-spend.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLedger, validateLedger } from "./lib/spend-ledger.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledger = await loadLedger(root);
const result = validateLedger(ledger);
for (const error of result.errors) console.error(`error: ${error}`);
if (!result.valid) process.exit(1);
console.log(`spend ledger valid: $${result.totals.committed.toFixed(2)} committed of $${result.totals.cap} across ${result.totals.entries} entries; $${result.totals.remaining.toFixed(2)} remaining`);
```

Add `"spend:validate": "node scripts/validate-spend.mjs"` to `package.json` and run it in `check` after `translations:validate`.

- [x] **Step 4: Run the test and the CLI**

Run: `node --test tests/v2-spend-ledger.test.mjs && node scripts/validate-spend.mjs`
Expected: `# pass 4` and `spend ledger valid: $0.00 committed of $10 across 0 entries; $10.00 remaining`

- [x] **Step 5: Commit**

```bash
git add content/spend scripts/lib/spend-ledger.mjs scripts/validate-spend.mjs tests/v2-spend-ledger.test.mjs package.json
git commit -m "feat: add the v2 spend ledger with a ten-dollar cap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Anatomy contracts, generator, manifest, and validator

**Files:**
- Create: `content/anatomy/contracts.json`
- Create: `scripts/lib/anatomy.mjs`
- Create: `scripts/generate-anatomy.mjs`
- Create: `scripts/validate-anatomy.mjs`
- Modify: `package.json` (`anatomy:generate`, `anatomy:validate` in `check`)
- Test: `tests/v2-anatomy.test.mjs`

**Interfaces:**
- Consumes: Task 1's ledger functions; the frames manifest (Task 4 adds `layers`).
- Produces: `CONTRACTS_PATH`, `MANIFEST_PATH`, `MODELS`, `IMAGE_SIZES`, `STATUSES`, `sha256(bytes)`, `loadContracts(root)`, `loadManifest(root)`, `validateContracts(contracts)`, `attemptsFor(manifest, assetId)`, `acceptedRecord(manifest, assetId)`, `planAttempt({ contracts, manifest, assetId }) -> { assetId, attempt, model, parentFile, input, estimateUsd, file, ledgerId }`, `recordCandidate(manifest, plan, { bytes, width, height, requestId, seed }) -> manifest`, `setStatus(manifest, recordId, status, note) -> manifest`, `validateAnatomy({ contracts, manifest, frames, root }) -> { valid, errors }`.
- Manifest record shape: `{ id, asset_id, attempt, file, sha256, width, height, model, prompt, seed, request_id, estimate_usd, ledger_entry, status, note, review: { inspection, observers, adjudication } }`.

- [x] **Step 1: Write the failing test**

```js
// tests/v2-anatomy.test.mjs
import assert from "node:assert/strict";
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
  for (const asset of contracts.assets.filter((item) => item.kind === "edit")) {
    assert.ok(contracts.assets.some((item) => item.id === asset.parent && item.kind === "master"), asset.id);
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
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --test tests/v2-anatomy.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/anatomy.mjs'`

- [x] **Step 3: Write the contracts**

Prompts describe a neutral adult, a clean medical-illustration style with soft shading and accurate anatomy, no text of any kind, and nothing clinical the overlays will draw. Seeds are fixed so attempts are reproducible; each attempt uses `seed + attempt - 1`.

```json
{
  "schema_version": "1.0",
  "artifact_id": "ci-phase0",
  "artifact_version": "0.1.0",
  "status": "unverified_draft",
  "patient_use": false,
  "notice": "UNVERIFIED CONCEPT ART — NOT FOR PATIENT USE",
  "register": "Contemporary medical illustration: accurate adult anatomy, soft even lighting, muted skin tones, clean off-white background, no text of any kind. One consistent adult across every asset. Nothing clinical that the overlays draw: no tape, no labels, no arrows, no devices before activation.",
  "grounding": "Prompts follow evals/safety-cards/medical-reference-packet.md: the incision runs behind the ear in the postauricular crease; the immediate dressing is a full head wrap covering the operated ear; fluid is a localized subcutaneous bulge behind the ear; the external system is a behind-the-ear processor with a round transmitter coil held on the scalp above and behind the ear. Reference images inform these sentences and are never uploaded.",
  "assets": [
    {
      "id": "postauricular-base",
      "kind": "master",
      "model": "fal-ai/flux-2-pro",
      "image_size": "landscape_4_3",
      "seed": 90101,
      "max_attempts": 3,
      "claim": {
        "sentence_ids": ["wc.02", "wc.03", "wc.05", "call.01a"],
        "anatomy": "The area behind an adult's right ear, seen from behind and slightly to the side, hair kept away from the ear.",
        "state": "A healed, thin, pale incision line running in the crease behind the ear, from just above the ear down toward the earlobe. No dressing, no tape, no redness, no swelling, no device.",
        "forbidden": ["incision on the cheek, jaw, neck, or in front of the ear", "tape or a dressing present", "a hearing device worn", "visible redness or swelling", "blood or an open wound", "any text, arrow, or label"]
      },
      "prompt": "Medical illustration of the area behind an adult person's right ear, viewed from behind and slightly to the side, short hair kept away from the ear so the skin behind the ear is fully visible. A thin, pale, fully healed surgical incision line runs in the natural crease directly behind the ear, from just above the top of the ear down toward the earlobe, following the curve of the ear. Calm neutral expression, ear and skin otherwise completely normal: no tape, no dressing, no bandage, no redness, no swelling, no device, no blood. Contemporary medical illustration style with accurate anatomy, soft even lighting, muted natural skin tones, clean off-white background, sharp focus on the area behind the ear. No text, no labels, no captions, no arrows, no logos, no watermark.",
      "observers_must_recover": ["the back or side of a person's head with the area behind the ear in view", "a thin healed line or scar behind the ear, not on the face or neck", "no bandage, tape, or device"]
    },
    {
      "id": "postauricular-dressing",
      "kind": "edit",
      "parent": "postauricular-base",
      "model": "fal-ai/flux-2-pro/edit",
      "image_size": "landscape_4_3",
      "seed": 90201,
      "max_attempts": 3,
      "claim": {
        "sentence_ids": ["wc.01"],
        "anatomy": "The same person and view.",
        "state": "A snug white gauze head wrap covers the operated ear and the area behind it, wrapping around the head above the eyebrows. The face is unchanged.",
        "forbidden": ["loose gauze held beside the ear", "the ear uncovered", "a helmet or hat instead of a gauze wrap", "any text or label"]
      },
      "prompt": "Edit this medical illustration so a snug white gauze mastoid head wrap covers the ear and the area behind it, wrapping fully around the head above the eyebrows and under the chin-line hair, like a postoperative head bandage. Keep the same person, pose, viewpoint, lighting, background, and illustration style. The wrap must cover the ear completely. No text, no labels, no captions, no arrows, no logos.",
      "observers_must_recover": ["a white head bandage wrapped around the head", "the ear covered by the bandage", "the same view of the head"]
    },
    {
      "id": "postauricular-red-swollen",
      "kind": "edit",
      "parent": "postauricular-base",
      "model": "fal-ai/flux-2-pro/edit",
      "image_size": "landscape_4_3",
      "seed": 90301,
      "max_attempts": 3,
      "claim": {
        "sentence_ids": ["call.01a"],
        "anatomy": "The same person and view.",
        "state": "The skin along and around the incision line behind the ear is reddened and mildly swollen. Nothing else changes.",
        "forbidden": ["bleeding or an open wound", "pus", "redness on the face or neck instead of behind the ear", "any text or label"]
      },
      "prompt": "Edit this medical illustration so the skin along and immediately around the healed incision line behind the ear becomes visibly reddened and mildly swollen, a smooth warm pink-red flush with slight puffiness confined to the area behind the ear. No bleeding, no open wound, no pus. Keep the same person, pose, viewpoint, lighting, background, and illustration style. No text, no labels, no captions, no arrows, no logos.",
      "observers_must_recover": ["redness behind the ear along a scar or incision", "some swelling in the same area", "no open wound"]
    },
    {
      "id": "postauricular-fluid",
      "kind": "edit",
      "parent": "postauricular-base",
      "model": "fal-ai/flux-2-pro/edit",
      "image_size": "landscape_4_3",
      "seed": 90401,
      "max_attempts": 3,
      "claim": {
        "sentence_ids": ["call.03"],
        "anatomy": "The same person and view.",
        "state": "A smooth, localized, soft bulge under the skin behind the ear, as fluid collected under the skin would look. Skin color otherwise normal.",
        "forbidden": ["droplets, sweat, or liquid running on the skin", "a wound or opening", "strong redness", "any text or label"]
      },
      "prompt": "Edit this medical illustration so a smooth, localized, soft bulge appears under the skin behind the ear near the incision, the way fluid collected under the skin would look, gently raising the skin without breaking it. No droplets, no liquid on the surface, no wound, no strong redness. Keep the same person, pose, viewpoint, lighting, background, and illustration style. No text, no labels, no captions, no arrows, no logos.",
      "observers_must_recover": ["a rounded swelling or bulge under the skin behind the ear", "no liquid on the surface", "the same view of the head"]
    },
    {
      "id": "processor-worn",
      "kind": "master",
      "model": "fal-ai/flux-2-pro",
      "image_size": "landscape_4_3",
      "seed": 90501,
      "max_attempts": 3,
      "claim": {
        "sentence_ids": ["act.02"],
        "anatomy": "The same adult in profile from the right side, showing the ear and the scalp above and behind it.",
        "state": "A slim behind-the-ear sound processor sits over the top of the ear with a short cable to a small round transmitter coil resting on the scalp above and behind the ear. No dressing, no tape, no incision emphasis, no brand shapes.",
        "forbidden": ["a device inside the ear canal like an earbud", "a patch or mark on the neck", "a headset or headphones", "a dressing or tape", "any text, logo, or label"]
      },
      "prompt": "Medical illustration of an adult person's head in right profile, short hair kept away from the ear. The person wears a slim behind-the-ear sound processor resting over the top of the ear, connected by a short thin cable to a small round flat transmitter coil that sits on the scalp a few centimetres above and behind the ear. Plain generic device shapes in matte dark grey, no brand, no buttons drawn in detail. Calm neutral expression, no bandage, no tape, no redness. Contemporary medical illustration style with accurate anatomy, soft even lighting, muted natural skin tones, clean off-white background. No text, no labels, no captions, no arrows, no logos, no watermark.",
      "observers_must_recover": ["a hearing device worn behind the ear", "a small round piece on the scalp above and behind the ear connected by a cable", "a person's head in profile"]
    }
  ]
}
```

- [x] **Step 4: Write the library**

```js
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
  const attempt = attempts.length + 1;
  return {
    assetId,
    attempt,
    model: MODELS[asset.kind],
    parentFile: parent?.file ?? null,
    input: { prompt: asset.prompt, image_size: asset.image_size, seed: asset.seed + attempt - 1, output_format: "png", enable_safety_checker: true },
    estimateUsd: estimateFluxUsd({ outputMegapixels, inputMegapixels }),
    file: `assets/anatomy/${assetId}-a${attempt}.png`,
    ledgerId: `anatomy:${assetId}:a${attempt}`
  };
}

export function recordCandidate(manifest, plan, { bytes, width, height, requestId, seed }) {
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
```

- [x] **Step 5: Write the generator and validator CLIs**

```js
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
```

```js
// scripts/validate-anatomy.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadContracts, loadManifest, validateAnatomy } from "./lib/anatomy.mjs";
import { loadFrameManifest } from "./lib/frames.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [contracts, manifest, frames] = await Promise.all([loadContracts(root), loadManifest(root), loadFrameManifest(root)]);
const result = await validateAnatomy({ contracts, manifest, frames, root });
for (const error of result.errors) console.error(`error: ${error}`);
if (!result.valid) process.exit(1);
const accepted = (manifest.records ?? []).filter((record) => record.status === "accepted").length;
console.log(`anatomy valid: ${contracts.assets.length} contracts, ${(manifest.records ?? []).length} records, ${accepted} accepted`);
```

Add to `package.json`: `"anatomy:generate": "node --env-file=.env.local scripts/generate-anatomy.mjs"` and `"anatomy:validate": "node scripts/validate-anatomy.mjs"`, the latter in `check` after `frames:validate`. In a worktree without `.env.local`, run the generator as `node --env-file=<main checkout>/.env.local scripts/generate-anatomy.mjs`.

- [x] **Step 6: Run the tests, the validator, and a dry run**

Run: `node --test tests/v2-anatomy.test.mjs && node scripts/validate-anatomy.mjs && node scripts/generate-anatomy.mjs --dry-run --asset postauricular-base`
Expected: `# pass 4`, `anatomy valid: 5 contracts, 0 records, 0 accepted`, the plan JSON with `"estimate_usd": 0.03`, and `dry run: no request, no spend`.

- [x] **Step 7: Commit**

```bash
git add content/anatomy scripts/lib/anatomy.mjs scripts/generate-anatomy.mjs scripts/validate-anatomy.mjs tests/v2-anatomy.test.mjs package.json
git commit -m "feat: contract, generate, and validate anatomy masters under the spend ledger

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Generate, inspect, observe, and accept the assets

This task spends money. Order: base master first, shown to John as soon as it exists; then the three edits of the accepted base; then the processor master. Each run is one attempt; inspect before the next.

**Files:**
- Create: `reviewers/anatomy/observer.md`, `reviewers/anatomy/adjudicator.md`
- Create: `assets/anatomy/*.png`, `assets/anatomy/manifest.json` (by the generator)
- Create: `content/reviews/anatomy/<record-id>.json` (receipts)
- Modify: `content/spend/v2-ledger.json` (by the generator)

- [x] **Step 1: Write the observer and adjudicator personas**

```markdown
<!-- reviewers/anatomy/observer.md -->
# Caption-blind observer

You see one image and nothing else: no caption, no intended meaning, no clinical claim, no earlier findings. Answer in under 120 words, as plain observations:

1. What part of the body is shown, and from where?
2. What physical state or object do you see on it? Name anything worn, applied, or wrong with the skin.
3. Is there any text, arrow, label, or symbol in the image?
4. What could this picture be mistaken for? Name one alternative reading a worried patient might have.

Do not guess at a diagnosis. Do not say what the image is "supposed" to show. Describe only what is drawn.
```

```markdown
<!-- reviewers/anatomy/adjudicator.md -->
# Semantic adjudicator

You receive one asset contract (anatomy, state, forbidden readings, what observers must recover) and three independent caption-blind observations of the candidate image. You never see the image.

Return JSON: `{ "verdict": "pass" | "fail", "recovered": [strings each observer recovered], "missed": [items in observers_must_recover that fewer than three observers recovered], "forbidden_hits": [forbidden readings any observer reported], "text_detected": boolean, "reason": one sentence }`.

Fail when any observer reports text, any observer reports a forbidden reading, or any required item is recovered by fewer than three observers. Text may never rescue a failing picture.
```

- [x] **Step 2: Generate the base master**

Run: `node --env-file=/Users/johnkuo/Documents/ChatGPT/avs-video/.env.local scripts/generate-anatomy.mjs --asset postauricular-base`
Then look at `assets/anatomy/postauricular-base-a1.png` with the image reader. Accept only if: the view is behind the ear, one thin healed line sits in the crease behind the ear, nothing is worn or applied, and the image holds no text. Otherwise record a `rejected` status with the reason via a small Node one-liner using `setStatus`, delete the PNG, and run attempt 2 (the seed advances automatically). Stop at 3 attempts and report.

- [x] **Step 3: Send the accepted base to John**

Send the PNG with a one-line caption naming the register, so the style can be redirected before the edits spend.

- [x] **Step 4: Run the observation loop on the base**

Launch three fresh observer agents in one message, each with only `reviewers/anatomy/observer.md` and the image path, no other context. Then one adjudicator agent with the contract and the three observations. Write `content/reviews/anatomy/<record-id>.json`:

```json
{
  "schema_version": "1.0",
  "record_id": "postauricular-base-a1",
  "sha256": "<from the manifest>",
  "reviewers": [{ "role": "observer", "kind": "ai", "label": "Caption-blind observer (Claude), not a clinician", "date": "2026-09-17", "text": "..." }],
  "adjudication": { "kind": "ai", "label": "Semantic adjudicator (Claude), not a clinician", "date": "2026-09-17", "verdict": "pass", "detail": {} },
  "clinical": { "status": "pending", "label": "Clinician review pending" },
  "patient_use": false
}
```

Store the receipt path and verdict in the manifest record's `review` field. A `fail` verdict rejects the record: delete the PNG, keep the record with the reason, and try the next attempt with the prompt adjusted in the contract to remove the wrong reading.

- [x] **Step 5: Generate the three edits and the processor master**

Run the generator once per asset, in this order: `postauricular-dressing`, `postauricular-red-swollen`, `postauricular-fluid`, `processor-worn`. Inspect each; edits must keep the same person and view. Run the observation loop on each accepted record. Expected total spend for the task: between `$0.20` and `$0.60`.

- [x] **Step 6: Validate and commit**

Run: `node scripts/validate-anatomy.mjs && node scripts/validate-spend.mjs`
Expected: `anatomy valid: 5 contracts, N records, 5 accepted` and the ledger line under `$1.00`.

```bash
git add assets/anatomy content/spend content/reviews/anatomy reviewers/anatomy
git commit -m "feat: generate and review the anatomy masters and their state edits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Composite frames on the narration clock

**Files:**
- Modify: `content/frames/ci-phase0-v0.1.0.frames.json`
- Modify: `scripts/lib/frames.mjs` (composite validation)
- Modify: `guide/assets/frames.js` (composite renderer and `updateFrame`)
- Modify: `guide/assets/guide.js` (pass beat words; call `updateFrame` each tick)
- Modify: `guide/assets/guide.css`
- Modify: `content/translations/en/ci-phase0-v0.1.0.json` (`ov.*` labels)
- Modify: `tests/v2-frames.test.mjs`, `tests/v2-guide-logic.test.mjs`

**Interfaces:**
- Composite frame shape: `{ kind: "composite", alt, layers: { name: "assets/anatomy/<file>" }, anchors: { name: { x, y } } (0 to 1 of the image), states: [{ id, image, from?, until? }], overlays: [{ id, type, anchor?, at?: { x, y }, from?, until?, label_key?, sentence_ids, rows?: [{ label_key, from, sentence_ids }], ...type fields }] }`. `from` and `until` are phrases from the beat's narration; a missing `from` means visible from the beat's start.
- Overlay types: `tape-strip` (`width`, `angle`), `inset` (`at`, `radius`, `scale`, `tape: boolean`), `no-cleaning` (`at`), `checklist` (`at`, `rows`), `rows` (`at`, `rows`), `steps` (`at`, `rows`), `pointer` (`at`, `anchor`).
- `guide/assets/frames.js` exports `renderFrame(frame, { beat, beatWords, sentences, pack })`, `updateFrame(node, seconds)`, `phraseTime(words, phrase) -> seconds | null`.

- [x] **Step 1: Extend the tests**

Append to `tests/v2-guide-logic.test.mjs` (phrase timing lives in `frames.js`, which is DOM-free only for this function, so import it directly):

```js
import { phraseTime } from "../guide/assets/frames.js";

test("phrases resolve to the start of their first word, ignoring case and punctuation", () => {
  const words = timeline.words;
  assert.equal(phraseTime(words, "remove the head bandage"), words.find((word) => word.text === "remove").start);
  assert.equal(phraseTime(words, "Then check:"), words.find((word) => word.text === "Then").start);
  assert.equal(phraseTime(words, "not in the narration"), null);
  assert.equal(phraseTime(words, ""), null);
});
```

Append to `tests/v2-frames.test.mjs`:

```js
test("composite frames name accepted layers, anchors within the image, overlays with labels and sentence ids", async () => {
  const frames = await loadFrameManifest(root);
  const composites = Object.entries(frames.frames).filter(([, frame]) => frame.kind === "composite");
  assert.ok(composites.length >= 4);
  const broken = structuredClone(frames);
  const [id, frame] = composites[0];
  broken.frames[id] = { ...frame, anchors: { bad: { x: 2, y: 0.5 } }, states: [{ id: "s", image: "missing-layer" }], overlays: [{ id: "o", type: "unknown", label_key: "ov.nope", sentence_ids: ["zz.99"] }] };
  const result = await validateFrames({ frames: broken, segments: bundle.segments, root, labels: englishLabels });
  const text = result.errors.join("\n");
  assert.match(text, new RegExp(`${id} anchor bad must sit within the image`));
  assert.match(text, new RegExp(`${id} state s names layer missing-layer`));
  assert.match(text, new RegExp(`${id} overlay o has unsupported type unknown`));
  assert.match(text, new RegExp(`${id} overlay o label ov\\.nope is not in the English pack`));
  assert.match(text, new RegExp(`${id} overlay o sentence zz\\.99 is not spoken by a beat that uses this frame`));
});
```

`validateFrames` gains a `labels` argument (the English pack's labels); the test file loads it: `const englishLabels = JSON.parse(await readFile(resolve(root, "content/translations/en/ci-phase0-v0.1.0.json"), "utf8")).labels;`.

- [x] **Step 2: Run them to verify they fail**

Run: `node --test tests/v2-guide-logic.test.mjs tests/v2-frames.test.mjs`
Expected: the two new tests fail (`phraseTime` is not exported; no composite frames yet).

- [x] **Step 3: Extend the frames validator**

In `scripts/lib/frames.mjs`, extend `FRAME_KINDS` with `"composite"` and add to `validateFrames({ frames, segments, root, labels = {} })`, inside the per-frame loop before the `text` branch:

```js
    if (frame.kind === "composite") {
      const layers = frame.layers ?? {};
      if (!Object.keys(layers).length) errors.push(`${id} needs at least one layer`);
      for (const [name, file] of Object.entries(layers)) {
        if (!(await exists(join(root, file)))) errors.push(`${id} layer ${name} file ${file} does not exist`);
      }
      for (const [name, anchor] of Object.entries(frame.anchors ?? {})) {
        if (!(anchor.x >= 0 && anchor.x <= 1 && anchor.y >= 0 && anchor.y <= 1)) errors.push(`${id} anchor ${name} must sit within the image`);
      }
      for (const state of frame.states ?? []) {
        if (!layers[state.image]) errors.push(`${id} state ${state.id} names layer ${state.image}, which is not a layer`);
      }
      const spoken = new Set(usedBy.get(id) ?? []);
      for (const overlay of frame.overlays ?? []) {
        if (!OVERLAY_TYPES.includes(overlay.type)) errors.push(`${id} overlay ${overlay.id} has unsupported type ${overlay.type}`);
        if (overlay.anchor && !frame.anchors?.[overlay.anchor]) errors.push(`${id} overlay ${overlay.id} anchor ${overlay.anchor} is not defined`);
        const keys = [overlay.label_key, ...(overlay.rows ?? []).map((row) => row.label_key)].filter(Boolean);
        for (const key of keys) if (typeof labels[key] !== "string" || !labels[key].trim()) errors.push(`${id} overlay ${overlay.id} label ${key} is not in the English pack`);
        const sentenceIds = [...(overlay.sentence_ids ?? []), ...(overlay.rows ?? []).flatMap((row) => row.sentence_ids ?? [])];
        if (!sentenceIds.length) errors.push(`${id} overlay ${overlay.id} needs sentence_ids`);
        for (const sentenceId of sentenceIds) if (!spoken.has(sentenceId)) errors.push(`${id} overlay ${overlay.id} sentence ${sentenceId} is not spoken by a beat that uses this frame`);
      }
      if (!frame.alt?.trim()) errors.push(`${id} needs alt text`);
      continue;
    }
```

with `export const OVERLAY_TYPES = Object.freeze(["tape-strip", "inset", "no-cleaning", "checklist", "rows", "steps", "pointer"]);` and a `usedBy` map built in the beat loop: `usedBy.set(beat.frame, [...(usedBy.get(beat.frame) ?? []), ...beat.sentence_ids])`. `scripts/validate-frames.mjs` loads the English pack and passes `labels`.

- [x] **Step 4: Write the composite frames**

Replace the anatomy-bearing entries in `content/frames/ci-phase0-v0.1.0.frames.json` (anchor values are calibrated against the accepted images in Task 3 by reading each PNG and noting where the incision, the top of the ear, and the coil sit; start from the values below and adjust):

```json
    "frame-01": {
      "kind": "composite",
      "alt": "Day 2: the head bandage comes off, then the area behind the ear is checked for tape.",
      "layers": { "base": "assets/anatomy/postauricular-base-a1.png", "dressing": "assets/anatomy/postauricular-dressing-a1.png" },
      "anchors": { "incision": { "x": 0.56, "y": 0.5 } },
      "states": [
        { "id": "dressing-on", "image": "dressing", "until": "remove" },
        { "id": "bandage-off", "image": "base", "from": "remove" }
      ],
      "overlays": [
        { "id": "tape-question", "type": "inset", "anchor": "incision", "at": { "x": 0.82, "y": 0.3 }, "radius": 0.19, "scale": 2.2, "tape": true, "from": "tape", "label_key": "ov.tape_question", "sentence_ids": ["wc.02"] }
      ]
    },
    "frame-0203-paths": {
      "kind": "composite",
      "alt": "Two paths behind the ear: with tape, keep it dry for three days and do not clean; without tape, clean gently twice a day with the half-and-half mix, then ointment.",
      "layers": { "base": "assets/anatomy/postauricular-base-a1.png" },
      "anchors": { "incision": { "x": 0.56, "y": 0.5 } },
      "states": [{ "id": "base", "image": "base" }],
      "overlays": [
        { "id": "tape", "type": "tape-strip", "anchor": "incision", "width": 150, "angle": -28, "from": "If there is tape", "until": "If there is no tape", "sentence_ids": ["wc.03"] },
        { "id": "keep-dry", "type": "pointer", "anchor": "incision", "at": { "x": 0.78, "y": 0.22 }, "from": "keep the area dry", "until": "If there is no tape", "label_key": "ov.keep_dry", "sentence_ids": ["wc.03"] },
        { "id": "no-cleaning", "type": "no-cleaning", "at": { "x": 0.78, "y": 0.62 }, "from": "do not clean", "until": "If there is no tape", "label_key": "ov.no_cleaning", "sentence_ids": ["wc.04"] },
        { "id": "clean-steps", "type": "steps", "at": { "x": 0.66, "y": 0.18 }, "from": "If there is no tape", "rows": [
          { "label_key": "ov.clean_twice", "from": "clean the edges", "sentence_ids": ["wc.05"] },
          { "label_key": "ov.mix", "from": "equal parts", "sentence_ids": ["wc.06"] },
          { "label_key": "ov.ointment", "from": "then apply", "sentence_ids": ["wc.07"] }
        ], "sentence_ids": ["wc.05", "wc.06", "wc.07"] }
      ]
    },
    "frame-06-redness": {
      "kind": "composite",
      "alt": "Redness and swelling behind the ear, with three signs that must all be present before calling.",
      "layers": { "red": "assets/anatomy/postauricular-red-swollen-a1.png" },
      "anchors": { "incision": { "x": 0.56, "y": 0.5 } },
      "states": [{ "id": "red", "image": "red" }],
      "overlays": [
        { "id": "signs", "type": "checklist", "at": { "x": 0.62, "y": 0.16 }, "rows": [
          { "label_key": "ov.red_swollen", "from": "red and swollen", "sentence_ids": ["call.01a"] },
          { "label_key": "ov.not_better", "from": "not getting better", "sentence_ids": ["call.01b"] },
          { "label_key": "ov.hurts", "from": "hurts", "sentence_ids": ["call.01c"] }
        ], "sentence_ids": ["call.01"] }
      ]
    },
    "frame-0710-anylist": {
      "kind": "composite",
      "alt": "Four separate reasons to call: a fever above 101.5 degrees Fahrenheit, swelling or fluid behind the ear, headache or light sensitivity or excessive lethargy, or any question or concern.",
      "layers": { "fluid": "assets/anatomy/postauricular-fluid-a1.png" },
      "anchors": { "bulge": { "x": 0.58, "y": 0.52 } },
      "states": [{ "id": "fluid", "image": "fluid" }],
      "overlays": [
        { "id": "any", "type": "rows", "at": { "x": 0.6, "y": 0.14 }, "rows": [
          { "label_key": "ov.fever", "from": "a fever", "sentence_ids": ["call.02"] },
          { "label_key": "ov.fluid", "from": "swelling", "sentence_ids": ["call.03"] },
          { "label_key": "ov.neuro", "from": "a headache", "sentence_ids": ["call.04"] },
          { "label_key": "ov.any_concern", "from": "or any question", "sentence_ids": ["call.05"] }
        ], "sentence_ids": ["call.02"] },
        { "id": "bulge-pointer", "type": "pointer", "anchor": "bulge", "at": { "x": 0.2, "y": 0.86 }, "from": "swelling", "label_key": "ov.fluid_pointer", "sentence_ids": ["call.03"] }
      ]
    },
    "frame-13-programming": {
      "kind": "composite",
      "alt": "The external speech processor worn behind the ear, with its transmitter coil on the scalp, at the programming visit.",
      "layers": { "worn": "assets/anatomy/processor-worn-a1.png" },
      "anchors": { "processor": { "x": 0.55, "y": 0.42 }, "coil": { "x": 0.5, "y": 0.28 } },
      "states": [{ "id": "worn", "image": "worn" }],
      "overlays": [
        { "id": "processor", "type": "pointer", "anchor": "processor", "at": { "x": 0.8, "y": 0.6 }, "from": "speech processor", "label_key": "ov.processor", "sentence_ids": ["act.02"] }
      ]
    },
    "frame-0405-milestones": { "kind": "text" },
    "frame-11-numbers": { "kind": "text" }
```

Add the labels to the English pack, each mapped to its sentence:

```json
    "ov.tape_question": "Tape?",
    "ov.keep_dry": "Keep dry until 3 days after surgery",
    "ov.no_cleaning": "No cleaning before then",
    "ov.clean_twice": "Clean the edges gently, twice a day",
    "ov.mix": "Equal parts hydrogen peroxide and distilled water",
    "ov.ointment": "Then an antibiotic ointment, such as bacitracin",
    "ov.red_swollen": "Red and swollen",
    "ov.not_better": "Not getting better over one to two days",
    "ov.hurts": "Hurts when touched",
    "ov.fever": "Fever above 101.5 °F",
    "ov.fluid": "Swelling or fluid behind the ear",
    "ov.neuro": "Headache, light sensitivity, or excessive lethargy",
    "ov.any_concern": "Any question or concern",
    "ov.fluid_pointer": "Fluid under the skin",
    "ov.processor": "Speech processor, worn outside the ear"
```

- [x] **Step 5: Write the composite renderer**

Replace `guide/assets/frames.js` with a version that keeps `renderTitleCard` and the `text` and image branches, and adds:

```js
const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW = { w: 1000, h: 750 };
const NAVY = "#052049";
const TEAL = "#14828c";
const YELLOW = "#feb80a";
const RED = "#b3261e";

const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function phraseTime(words, phrase) {
  if (!phrase || !words?.length) return null;
  const target = normalize(phrase).split(" ").filter(Boolean);
  if (!target.length) return null;
  for (let index = 0; index <= words.length - target.length; index += 1) {
    if (target.every((token, offset) => normalize(words[index + offset].text) === token)) return words[index].start;
  }
  return null;
}

function svg(name, attributes = {}, children = []) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  for (const child of children) node.append(child);
  return node;
}

function label(x, y, text, { size = 30, weight = 700, fill = NAVY, anchor = "start", maxWidth = 380 } = {}) {
  const group = svg("g");
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length * size * 0.52 > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  lines.forEach((content, index) => {
    const node = svg("text", { x, y: y + index * size * 1.25, "font-size": size, "font-weight": weight, fill, "text-anchor": anchor, "font-family": "'Helvetica Neue', Helvetica, Arial, sans-serif" });
    node.textContent = content;
    group.append(node);
  });
  return group;
}

function point(frame, ref) {
  const anchor = typeof ref === "string" ? frame.anchors?.[ref] : ref;
  return { x: (anchor?.x ?? 0.5) * VIEW.w, y: (anchor?.y ?? 0.5) * VIEW.h };
}

function tapeStrip(x, y, width, angle) {
  return svg("g", { transform: `translate(${x} ${y}) rotate(${angle})` }, [
    svg("rect", { x: -width / 2, y: -22, width, height: 44, rx: 8, fill: "#f4e3b3", stroke: NAVY, "stroke-width": 4 }),
    svg("line", { x1: -width / 2 + 16, y1: 0, x2: width / 2 - 16, y2: 0, stroke: NAVY, "stroke-width": 2, "stroke-dasharray": "6 8" })
  ]);
}

function drawOverlay(overlay, frame, layers, labels, register, words) {
  const group = svg("g", { class: `overlay overlay--${overlay.type}` });
  const at = point(frame, overlay.at ?? overlay.anchor);
  const anchor = point(frame, overlay.anchor ?? overlay.at);
  if (overlay.type === "tape-strip") {
    group.append(tapeStrip(anchor.x, anchor.y, overlay.width ?? 150, overlay.angle ?? -25));
  } else if (overlay.type === "inset") {
    const radius = (overlay.radius ?? 0.18) * VIEW.h;
    const scale = overlay.scale ?? 2;
    const clipId = `clip-${frame.id ?? "f"}-${overlay.id}`;
    const clip = svg("clipPath", { id: clipId }, [svg("circle", { cx: at.x, cy: at.y, r: radius })]);
    const image = svg("image", { href: layers.base ?? Object.values(layers)[0], x: at.x - anchor.x * scale, y: at.y - anchor.y * scale, width: VIEW.w * scale, height: VIEW.h * scale, preserveAspectRatio: "none", "clip-path": `url(#${clipId})` });
    group.append(clip, image);
    if (overlay.tape) group.append(svg("g", { "clip-path": `url(#${clipId})` }, [tapeStrip(at.x, at.y, 150 * scale * 0.5, -28)]));
    group.append(svg("circle", { cx: at.x, cy: at.y, r: radius, fill: "none", stroke: NAVY, "stroke-width": 6 }));
    group.append(svg("line", { x1: anchor.x, y1: anchor.y, x2: at.x, y2: at.y + radius, stroke: NAVY, "stroke-width": 4 }));
    if (overlay.label_key) group.append(label(at.x, at.y + radius + 44, labels[overlay.label_key] ?? "", { anchor: "middle", size: 32 }));
  } else if (overlay.type === "no-cleaning") {
    group.append(
      svg("rect", { x: at.x - 40, y: at.y - 70, width: 80, height: 130, rx: 14, fill: "#e8eef2", stroke: NAVY, "stroke-width": 4 }),
      svg("rect", { x: at.x - 18, y: at.y - 96, width: 36, height: 30, rx: 6, fill: "#e8eef2", stroke: NAVY, "stroke-width": 4 }),
      svg("circle", { cx: at.x, cy: at.y, r: 100, fill: "none", stroke: RED, "stroke-width": 12 }),
      svg("line", { x1: at.x - 70, y1: at.y - 70, x2: at.x + 70, y2: at.y + 70, stroke: RED, "stroke-width": 12, "stroke-linecap": "round" })
    );
    if (overlay.label_key) group.append(label(at.x, at.y + 150, labels[overlay.label_key] ?? "", { anchor: "middle", size: 30 }));
  } else if (overlay.type === "checklist" || overlay.type === "rows" || overlay.type === "steps") {
    (overlay.rows ?? []).forEach((row, index) => {
      const y = at.y + index * 96;
      const rowGroup = svg("g");
      if (overlay.type === "checklist") {
        rowGroup.append(svg("rect", { x: at.x, y: y - 26, width: 44, height: 44, rx: 8, fill: "#fff", stroke: NAVY, "stroke-width": 4 }));
        const check = svg("path", { d: `M ${at.x + 9} ${y - 3} l 11 12 l 18 -24`, fill: "none", stroke: TEAL, "stroke-width": 7, "stroke-linecap": "round", "stroke-linejoin": "round" });
        rowGroup.append(check);
        register(check, phraseTime(words, row.from), null);
      } else if (overlay.type === "steps") {
        rowGroup.append(svg("circle", { cx: at.x + 22, cy: y - 4, r: 24, fill: NAVY }));
        const number = svg("text", { x: at.x + 22, y: y + 7, "font-size": 30, "font-weight": 800, fill: "#fff", "text-anchor": "middle", "font-family": "'Helvetica Neue', Helvetica, Arial, sans-serif" });
        number.textContent = String(index + 1);
        rowGroup.append(number);
      } else {
        rowGroup.append(svg("rect", { x: at.x, y: y - 18, width: 16, height: 32, rx: 4, fill: YELLOW }));
      }
      rowGroup.append(label(at.x + 64, y + 6, labels[row.label_key] ?? "", { size: 28, maxWidth: 330 }));
      group.append(rowGroup);
      if (overlay.type !== "checklist") register(rowGroup, phraseTime(words, row.from), null);
    });
  } else if (overlay.type === "pointer") {
    const text = labels[overlay.label_key] ?? "";
    const width = Math.min(420, Math.max(160, text.length * 15));
    group.append(
      svg("line", { x1: anchor.x, y1: anchor.y, x2: at.x, y2: at.y, stroke: NAVY, "stroke-width": 4 }),
      svg("circle", { cx: anchor.x, cy: anchor.y, r: 10, fill: TEAL, stroke: "#fff", "stroke-width": 3 }),
      svg("rect", { x: at.x - width / 2, y: at.y - 30, width, height: 60, rx: 8, fill: "#fff", stroke: NAVY, "stroke-width": 3 }),
      label(at.x, at.y + 10, text, { anchor: "middle", size: 26, maxWidth: width - 20 })
    );
  }
  return group;
}

function renderComposite(frame, { beatWords, pack }) {
  const root = document.createElement("div");
  root.className = "frame frame--composite";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", frame.alt ?? "");
  const box = document.createElement("div");
  box.className = "composite";
  const schedule = [];
  const register = (node, from, until) => schedule.push({ node, from, until });
  const layers = Object.fromEntries(Object.entries(frame.layers ?? {}).map(([name, file]) => [name, assetUrl(file)]));
  const states = frame.states?.length ? frame.states : [{ id: "base", image: Object.keys(layers)[0] }];
  for (const state of states) {
    const image = document.createElement("img");
    image.className = "composite__image";
    image.src = layers[state.image];
    image.alt = "";
    image.decoding = "async";
    box.append(image);
    register(image, phraseTime(beatWords, state.from), phraseTime(beatWords, state.until));
  }
  const overlay = svg("svg", { class: "composite__overlay", viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, "aria-hidden": "true" });
  for (const item of frame.overlays ?? []) {
    const group = drawOverlay(item, frame, layers, pack.labels, register, beatWords);
    overlay.append(group);
    register(group, phraseTime(beatWords, item.from), phraseTime(beatWords, item.until));
  }
  box.append(overlay);
  root.append(box);
  root.__schedule = schedule;
  updateFrame(root, 0);
  return root;
}

export function updateFrame(root, seconds) {
  for (const item of root?.__schedule ?? []) {
    const on = (item.from == null || seconds >= item.from) && (item.until == null || seconds < item.until);
    if (item.node instanceof HTMLImageElement) item.node.style.opacity = on ? "1" : "0";
    else item.node.setAttribute("visibility", on ? "visible" : "hidden");
  }
}
```

and in `renderFrame`, before the image branch: `if (frame.kind === "composite") return renderComposite(frame, { beatWords, pack });` with `beatWords` accepted in the options. `frame.id` is set by `guide.js` when it looks a frame up (`{ ...frames.frames[beat.frame], id: beat.frame }`).

CSS additions:

```css
.frame--composite { width: 100%; height: 100%; }
.composite { position: relative; height: 100%; max-width: 100%; aspect-ratio: 4 / 3; margin: 0 auto; }
.composite__image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; transition: opacity .35s ease; }
.composite__overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
```

- [x] **Step 6: Drive composites from the clock**

In `guide/assets/guide.js`: `ensureFrame` passes `beatWords: timeline.words.filter((word) => word.beat === beat.id)` and the frame with its id; after the frame branch in `sync`, add `updateFrame(dom.stage.firstElementChild, local);` (imported from `frames.js`).

- [x] **Step 7: Run the tests and check**

Run: `node --test tests/v2-frames.test.mjs tests/v2-guide-logic.test.mjs && npm run check 2>&1 | tail -4`
Expected: all pass; `frames valid`, `anatomy valid`, and the total test count up by 2.

- [x] **Step 8: Verify in the browser**

Serve the worktree with the repo server, play chapter 1: the dressing image shows until "remove", then the base; the inset appears at "tape". Chapter 1's second beat: the tape strip and "keep dry" pointer during the first sentence, the prohibition at "do not clean", then the three steps landing on their phrases. Chapter 3: checks tick on their phrases; the four rows land in order; the fluid pointer appears at "swelling". Chapter 5: the processor pointer at "speech processor". Frames 2 and 4 show live-text cards. Check 390 px as well.

- [x] **Step 9: Commit**

```bash
git add content/frames content/translations scripts/lib/frames.mjs scripts/validate-frames.mjs guide/assets tests
git commit -m "feat: composite anatomy frames with deterministic overlays on the narration clock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Docs, status, and the pull request

- [x] **Step 1:** In `docs/PROJECT_STATUS.md`, "What exists" gains: `5. Generated anatomy masters under \`assets/anatomy/\` with deterministic overlays, contracted in \`content/anatomy/\`, reviewed caption-blind by AI observers with receipts under \`content/reviews/anatomy/\`, clinician review pending.` "Known gaps" item 1 becomes `### 1. Languages and the provider file are not built yet` with the sentence adjusted. "Best next contributions" item 1 becomes `1. Build v2 slice 4: Spanish and Mandarin packs with AI language reviewers.`
- [x] **Step 2:** Run `npm run check` and record the spend line from `node scripts/validate-spend.mjs` in the PR body.
- [x] **Step 3:** Commit, push `v2/slice-3-anatomy`, write `pr-body-slice-3.md` in the scratchpad following the contributing guide, and hand over the `gh pr create` command with `--base v2/slice-2-player-toc`.

---

## Self-review

- **Spec coverage:** section 5 (three masters as one master with state edits plus the processor master; controlled edits; every clinical mark deterministic; motion on timestamps; SVG fallbacks replaced by live text where no anatomy is needed; the image loop once per master with edits inheriting and a lighter check) is Tasks 2 to 4; section 9's gate by artifact class and section 10's ledger with a $10 cap and per-request entries are Tasks 1 and 3; section 13's failure handling (cap reached, missing key, provider error) is the generator; section 14's tests are in every task.
- **Placeholders:** none. Anchor values are starting values with a stated calibration step, not blanks.
- **Type consistency:** `planAttempt` returns `{ assetId, attempt, model, parentFile, input, estimateUsd, file, ledgerId }` and the generator and tests read exactly those; `validateFrames` gains `labels` in Task 4 and the test passes it; `renderFrame` takes `beatWords` and `guide.js` supplies it; `updateFrame(node, seconds)` is exported and called each tick.

## Outcome and deviations (2026-09-17)

- Accepted through the loop: `postauricular-base-a2` and `postauricular-fluid-a1`, each with three caption-blind observations, a passing adjudication, and a receipt under `content/reviews/anatomy/`.
- Not accepted: the head wrap (four attempts) and the red, swollen state (four attempts). Both caps were raised from three to the validator ceiling of four under John's ten-dollar authorization. Their best attempts stay as unaccepted candidates with receipts recording the failures, so Song and John can look at them without the guide using them.
- The processor master was dropped after four attempts; the guide draws the behind-the-ear processor and coil as a deterministic vector `device` overlay on the accepted base.
- `frame-06-redness` composes the accepted swelling master with a vector `flush` overlay (multiply-blended red tint), so the picture the patient sees carries both redness and swelling from reviewed material. `frame-01` shows the base master and the tape inset only; no head-bandage state is shown until a dressing passes.
- Composite frames keep a 4:3 box that fits the stage with container-query units, so the image never overflows the transcript column.
- Two integrity problems surfaced and are now guarded: three small-model observers answered without opening the image (the receipt tooling refuses any observer transcript without the Read call), and three small-model adjudications contradicted the rules (discarded, re-run on the session model, recorded in the receipts). Both personas now say so.
- `validateAnatomy` refuses an accepted record that lacks a passing adjudication or a receipt bound to the file hash.
- Spend: $0.57 of $10 across fifteen ledger entries.
