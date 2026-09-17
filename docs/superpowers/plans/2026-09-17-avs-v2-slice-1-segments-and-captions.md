# AVS v2 Slice 1: Segment Model, Narration Binding, and Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data spine of AVS v2: five validated segments bound to existing English narration, with per-segment timelines, WebVTT captions, and concatenated audio, all enforced by `npm run check`, at zero provider spend.

**Architecture:** A new `content/segments` JSON describes five segments as ordered beats; each beat binds canonical sentence IDs to a frame id and to a narration record in an existing audio manifest. Pure library modules under `scripts/lib/` derive word timings, per-segment timelines, cues, and ffmpeg concat commands from that JSON; thin CLIs validate and build committed artifacts under `assets/captions/v2/` and `assets/audio/v2/`. Later slices (player, diagrams, languages, provider file, reviewers, export) consume these files without changing them.

**Tech Stack:** Node 22 ES modules, `node:test`, JSON content files, ffmpeg and ffprobe (already required by CI), no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md`

## Slice roadmap

This is plan 1 of 7. Each later slice gets its own plan once the previous one ships:

1. Segment model, narration binding, timelines, captions, validators (this plan).
2. Player and TOC pages (`guide/index.html`, `guide/watch.html`) over the timelines, with fallback SVG frames and fragment parameters.
3. Anatomy masters and vector overlays, image loop, spend ledger.
4. Spanish and Mandarin packs, AI language reviewers, per-language narration and captions.
5. Provider file parser, presets, patient link, `guide/provider.html`, `ci/medications` module.
6. Simulated Song reviewer, receipt scripts, review badges.
7. Playwright and ffmpeg export of the fixed segments in 9:16.

## Global Constraints

- Node `>=20.6` per `package.json`; CI runs Node 22 with ffmpeg installed.
- No framework, no build step: vanilla ES modules, JSON, `node:test`; the dev server is `scripts/serve.mjs`.
- Canvas is `1080 x 1920` at `30` fps. Title card `1.5 s`, beat gap `0.6 s`, tail `0.9 s`.
- Hard ceiling `35 s` of narration per segment; `30 s` is the target and only warns.
- Every content file carries `patient_use: false` and the notice `UNVERIFIED — NOT FOR PATIENT USE`.
- Every canonical sentence ID appears in exactly one segment, in canonical order: wc.01–wc.10, call.01–call.08 including 01a, 01b, 01c, 07a, act.01–act.05 (27 IDs).
- Captions must reproduce the exact narration text; timestamps must cover every character (the existing manifest rule).
- The frozen activation pipeline (`scripts/lib/production-run.mjs`, `scripts/lib/activation-*.mjs`, `.production/`) is not modified.
- `.gitignore` excludes `.claude/`, `evals/`, `artifacts/`, `prototypes/`; everything this plan ships lives in tracked paths.
- Zero provider spend in this slice. Existing draft narration in `assets/audio/draft/manifest.json` and `assets/audio/manifest.json` is reused as-is.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Narration timing library

**Files:**
- Create: `scripts/lib/narration-timing.mjs`
- Test: `tests/v2-narration-timing.test.mjs`

**Interfaces:**
- Consumes: ElevenLabs manifest records `{ id, file, text, timestamps: [{ characters[], character_start_times_seconds[], character_end_times_seconds[] }] }` from `assets/audio/draft/manifest.json` and `assets/audio/manifest.json`.
- Produces: `flattenRecordCharacters(record) -> [{ character, start, end }]`, `speechEndSeconds(record) -> number`, `wordTimings(record) -> [{ text, charStart, start, end }]`. All throw `Error` when timestamps do not reproduce `record.text` or contain a non-finite or reversed time.

- [ ] **Step 1: Write the failing test**

```js
// tests/v2-narration-timing.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { flattenRecordCharacters, speechEndSeconds, wordTimings } from "../scripts/lib/narration-timing.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "assets/audio/draft/manifest.json"), "utf8"));
const record = manifest.records.find((item) => item.id === "wound-day2");

test("flattens a real draft record into one timed character per text position", () => {
  const characters = flattenRecordCharacters(record);
  assert.equal(characters.length, record.text.length);
  assert.equal(characters[0].character, "T");
  assert.ok(characters.every((entry, index) => index === 0 || entry.start >= characters[index - 1].start));
});

test("speech end is the last character end and words carry their own times", () => {
  const end = speechEndSeconds(record);
  const words = wordTimings(record);
  assert.equal(words[0].text, "Two");
  assert.equal(words.at(-1).end, end);
  assert.ok(words.every((word) => word.end >= word.start));
  assert.equal(words.length, record.text.split(/\s+/).length);
});

test("rejects drifted text and malformed timestamps", () => {
  const drifted = structuredClone(record);
  drifted.text += " Soon.";
  assert.throws(() => flattenRecordCharacters(drifted), /do not match/);
  const malformed = structuredClone(record);
  malformed.timestamps[0].character_end_times_seconds[0] = -1;
  assert.throws(() => flattenRecordCharacters(malformed), /malformed/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v2-narration-timing.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/narration-timing.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/narration-timing.mjs
// Word and character timing derived from an ElevenLabs manifest record.
// The activation pipeline has a private equivalent; it is frozen and does not
// export it, so this small module is the v2 source of truth for timing.

export function flattenRecordCharacters(record) {
  if (!record || typeof record.text !== "string") throw new Error("narration record needs text");
  const groups = Array.isArray(record.timestamps) ? record.timestamps : [];
  const characters = groups.flatMap((group) =>
    (group.characters ?? []).map((character, index) => ({
      character,
      start: group.character_start_times_seconds?.[index],
      end: group.character_end_times_seconds?.[index]
    }))
  );
  const flattened = characters.map((entry) => entry.character).join("");
  if (flattened !== record.text) {
    throw new Error(`narration record ${record.id} timestamps do not match its text`);
  }
  for (const entry of characters) {
    if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end < entry.start) {
      throw new Error(`narration record ${record.id} has a malformed timestamp`);
    }
  }
  return characters;
}

export function speechEndSeconds(record) {
  const characters = flattenRecordCharacters(record);
  return characters.length ? Math.max(...characters.map((entry) => entry.end)) : 0;
}

export function wordTimings(record) {
  const characters = flattenRecordCharacters(record);
  return [...record.text.matchAll(/\S+/g)].map((match) => {
    const first = match.index;
    const last = first + match[0].length - 1;
    return { text: match[0], charStart: first, start: characters[first].start, end: characters[last].end };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/v2-narration-timing.test.mjs`
Expected: `# pass 3`

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/narration-timing.mjs tests/v2-narration-timing.test.mjs
git commit -m "feat: derive word timings from narration manifests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Segment library and validator

**Files:**
- Create: `scripts/lib/segments.mjs`
- Create: `scripts/validate-segments.mjs` (CLI; the `--media` flag is wired in Task 6)
- Test: `tests/v2-segments.test.mjs`

**Interfaces:**
- Consumes: `speechEndSeconds(record)` from Task 1; `content/canonical/ci-phase0-v0.1.0.json` (`artifact.canonical_order`, `modules[].canonical_sentences[].id`); manifest records with `canonicalSentenceIds`.
- Produces: `SEGMENTS_PATH`, `CANVAS`, `NARRATION_CEILING_SECONDS`, `segmentSlug(id)`, `recordKey(binding)`, `resolveRecord(records, binding)`, `canonicalSentenceOrder(canonical) -> string[]`, `loadSegmentBundle(root) -> { segments, canonical, records: Map }`, `beatNarrationSeconds(beat, records, language)`, `segmentNarrationSeconds(segment, records, language)`, `validateSegments({ segments, canonical, records }) -> { valid, errors, warnings }`.
- The segments file shape (authored in Task 3): `{ schema_version: "1.0", artifact_id, artifact_version, status, patient_use: false, notice, canvas: { width, height, fps, title_card_seconds, beat_gap_seconds, tail_seconds }, segments: [{ id: "seg/<slug>", number, title_key, chip_key, data_fields?, beats: [{ id: "beat/<slug>", sentence_ids: string[], frame: string, condition?: string, status?: "pending_clinician_text", narration: { [language]: { manifest: string, record_id: string } } }] }] }`.

- [ ] **Step 1: Write the failing test**

The test needs the real segments file from Task 3 to exist for the positive case. Write the test now with the fixture-based negative cases and one positive case; the positive case will fail until Task 3 lands, which is expected and noted there.

```js
// tests/v2-segments.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  NARRATION_CEILING_SECONDS,
  canonicalSentenceOrder,
  loadSegmentBundle,
  segmentNarrationSeconds,
  segmentSlug,
  validateSegments
} from "../scripts/lib/segments.mjs";

const root = resolve(import.meta.dirname, "..");

function fixture() {
  const canonical = {
    artifact: { id: "fx", version: "1.0.0", canonical_order: ["m/a"] },
    modules: [{ id: "m/a", canonical_sentences: [{ id: "a.01", text: "One." }, { id: "a.02", text: "Two." }] }]
  };
  const record = {
    id: "r1",
    file: "assets/audio/fx/r1.mp3",
    text: "One. Two.",
    canonicalSentenceIds: ["a.01", "a.02"],
    timestamps: [{
      characters: [..."One. Two."],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    }]
  };
  const records = new Map([["assets/audio/fx/manifest.json#r1", record]]);
  const segments = {
    schema_version: "1.0",
    artifact_id: "fx",
    artifact_version: "1.0.0",
    status: "unverified_draft",
    patient_use: false,
    notice: "UNVERIFIED — NOT FOR PATIENT USE",
    canvas: { width: 1080, height: 1920, fps: 30, title_card_seconds: 1.5, beat_gap_seconds: 0.6, tail_seconds: 0.9 },
    segments: [{
      id: "seg/one",
      number: 1,
      title_key: "seg.one.title",
      chip_key: "seg.one.chip",
      beats: [{
        id: "beat/one",
        sentence_ids: ["a.01", "a.02"],
        frame: "frame-fx",
        narration: { en: { manifest: "assets/audio/fx/manifest.json", record_id: "r1" } }
      }]
    }]
  };
  return { segments, canonical, records, record };
}

test("the fixture validates and reports narration seconds", () => {
  const bundle = fixture();
  const result = validateSegments(bundle);
  assert.deepEqual(result.errors, []);
  assert.equal(segmentNarrationSeconds(bundle.segments.segments[0], bundle.records), 0.9);
  assert.deepEqual(canonicalSentenceOrder(bundle.canonical), ["a.01", "a.02"]);
  assert.equal(segmentSlug("seg/one"), "one");
});

test("coverage must equal the canonical order exactly", () => {
  const bundle = fixture();
  bundle.segments.segments[0].beats[0].sentence_ids = ["a.02", "a.01"];
  assert.match(validateSegments(bundle).errors.join("\n"), /coverage must equal the canonical order/);
  const dropped = fixture();
  dropped.segments.segments[0].beats[0].sentence_ids = ["a.01"];
  dropped.record.canonicalSentenceIds = ["a.01"];
  assert.match(validateSegments(dropped).errors.join("\n"), /missing: a\.02/);
});

test("beats must bind to real records that cover the same sentences", () => {
  const missing = fixture();
  missing.segments.segments[0].beats[0].narration.en.record_id = "nope";
  assert.match(validateSegments(missing).errors.join("\n"), /missing narration record nope/);
  const drift = fixture();
  drift.record.canonicalSentenceIds = ["a.01"];
  assert.match(validateSegments(drift).errors.join("\n"), /covers a\.01 but the beat declares a\.01,a\.02/);
});

test("structure rules: numbering, duplicate ids, conditional beats, ceiling", () => {
  const numbering = fixture();
  numbering.segments.segments[0].number = 2;
  assert.match(validateSegments(numbering).errors.join("\n"), /number must be 1/);
  const conditional = fixture();
  conditional.segments.segments[0].beats.push({ id: "beat/med", condition: "antibiotic", sentence_ids: [], frame: "frame-x", narration: {} });
  assert.match(validateSegments(conditional).errors.join("\n"), /must be status pending_clinician_text/);
  conditional.segments.segments[0].beats[1].status = "pending_clinician_text";
  assert.deepEqual(validateSegments(conditional).errors, []);
  const duplicate = fixture();
  duplicate.segments.segments[0].beats.push({ ...structuredClone(duplicate.segments.segments[0].beats[0]) });
  assert.match(validateSegments(duplicate).errors.join("\n"), /duplicate beat id/);
  const long = fixture();
  long.record.timestamps[0].character_end_times_seconds[8] = NARRATION_CEILING_SECONDS + 1;
  assert.match(validateSegments(long).errors.join("\n"), /over the 35s ceiling/);
});

test("the repository segments validate and stay under the ceiling", async () => {
  const bundle = await loadSegmentBundle(root);
  const result = validateSegments(bundle);
  assert.deepEqual(result.errors, []);
  assert.equal(bundle.segments.segments.length, 5);
  for (const segment of bundle.segments.segments) {
    assert.ok(segmentNarrationSeconds(segment, bundle.records) <= NARRATION_CEILING_SECONDS, segment.id);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v2-segments.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/segments.mjs'`

- [ ] **Step 3: Write the library**

```js
// scripts/lib/segments.mjs
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { speechEndSeconds } from "./narration-timing.mjs";

export const SEGMENT_SCHEMA_VERSION = "1.0";
export const SEGMENTS_PATH = "content/segments/ci-phase0-v0.1.0.segments.json";
export const NARRATION_CEILING_SECONDS = 35;
export const NARRATION_TARGET_SECONDS = 30;
export const CANVAS = Object.freeze({ width: 1080, height: 1920, fps: 30 });

export function segmentSlug(segmentId) {
  return segmentId.replace(/^seg\//, "");
}

export function recordKey(binding) {
  return `${binding.manifest}#${binding.record_id}`;
}

export function resolveRecord(records, binding) {
  return records.get(recordKey(binding)) ?? null;
}

export function canonicalSentenceOrder(canonical) {
  const modules = new Map(canonical.modules.map((module) => [module.id, module]));
  return canonical.artifact.canonical_order.flatMap((moduleId) =>
    modules.get(moduleId).canonical_sentences.map((sentence) => sentence.id)
  );
}

export async function loadSegmentBundle(root, segmentsPath = SEGMENTS_PATH) {
  const segments = JSON.parse(await readFile(join(root, segmentsPath), "utf8"));
  const canonicalPath = `content/canonical/${segments.artifact_id}-v${segments.artifact_version}.json`;
  const canonical = JSON.parse(await readFile(join(root, canonicalPath), "utf8"));
  const manifestPaths = new Set();
  for (const segment of segments.segments ?? []) {
    for (const beat of segment.beats ?? []) {
      for (const binding of Object.values(beat.narration ?? {})) manifestPaths.add(binding.manifest);
    }
  }
  const records = new Map();
  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8"));
    for (const record of manifest.records ?? []) records.set(`${manifestPath}#${record.id}`, record);
  }
  return { segments, canonical, records };
}

export function beatNarrationSeconds(beat, records, language = "en") {
  const binding = beat.narration?.[language];
  if (!binding) return 0;
  const record = resolveRecord(records, binding);
  if (!record) throw new Error(`${beat.id} references missing narration record ${binding.record_id}`);
  return speechEndSeconds(record);
}

export function segmentNarrationSeconds(segment, records, language = "en") {
  const total = segment.beats.reduce((sum, beat) => sum + beatNarrationSeconds(beat, records, language), 0);
  return Number(total.toFixed(3));
}

function sameSet(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function validateSegments({ segments, canonical, records }) {
  const errors = [];
  const warnings = [];
  if (segments.schema_version !== SEGMENT_SCHEMA_VERSION) errors.push(`schema_version must be ${SEGMENT_SCHEMA_VERSION}`);
  if (segments.artifact_id !== canonical.artifact.id || segments.artifact_version !== canonical.artifact.version) {
    errors.push("segments must reference the canonical artifact id and version");
  }
  if (segments.patient_use !== false) errors.push("patient_use must be false");
  const canvas = segments.canvas ?? {};
  if (canvas.width !== CANVAS.width || canvas.height !== CANVAS.height || canvas.fps !== CANVAS.fps) {
    errors.push(`canvas must be ${CANVAS.width}x${CANVAS.height} at ${CANVAS.fps} fps`);
  }
  for (const key of ["title_card_seconds", "beat_gap_seconds", "tail_seconds"]) {
    if (!(Number.isFinite(canvas[key]) && canvas[key] >= 0)) errors.push(`canvas.${key} must be a non-negative number`);
  }
  const covered = [];
  const segmentIds = new Set();
  const beatIds = new Set();
  let expectedNumber = 1;
  for (const segment of segments.segments ?? []) {
    if (segmentIds.has(segment.id)) errors.push(`duplicate segment id ${segment.id}`);
    segmentIds.add(segment.id);
    if (!/^seg\/[a-z0-9-]+$/.test(segment.id ?? "")) errors.push(`segment id ${segment.id} must look like seg/<slug>`);
    if (segment.number !== expectedNumber) errors.push(`${segment.id} number must be ${expectedNumber}`);
    expectedNumber += 1;
    if (!segment.title_key || !segment.chip_key) errors.push(`${segment.id} needs title_key and chip_key`);
    if (!Array.isArray(segment.beats) || segment.beats.length === 0) {
      errors.push(`${segment.id} needs at least one beat`);
      continue;
    }
    for (const beat of segment.beats) {
      if (beatIds.has(beat.id)) errors.push(`duplicate beat id ${beat.id}`);
      beatIds.add(beat.id);
      if (!beat.frame) errors.push(`${beat.id} needs a frame`);
      if (!Array.isArray(beat.sentence_ids)) {
        errors.push(`${beat.id} needs a sentence_ids array`);
        continue;
      }
      if (typeof beat.condition === "string") {
        if (beat.sentence_ids.length === 0 && beat.status !== "pending_clinician_text") {
          errors.push(`${beat.id} is conditional without sentences and must be status pending_clinician_text`);
        }
        if (beat.sentence_ids.length > 0) errors.push(`${beat.id}: conditional beats with sentences are not supported yet`);
        continue;
      }
      if (beat.sentence_ids.length === 0) errors.push(`${beat.id} needs sentence_ids`);
      covered.push(...beat.sentence_ids);
      const binding = beat.narration?.en;
      if (!binding?.manifest || !binding?.record_id) {
        errors.push(`${beat.id} needs English narration {manifest, record_id}`);
        continue;
      }
      const record = resolveRecord(records, binding);
      if (!record) {
        errors.push(`${beat.id} references missing narration record ${binding.record_id}`);
        continue;
      }
      try {
        speechEndSeconds(record);
      } catch (error) {
        errors.push(`${beat.id}: ${error.message}`);
      }
      if (Array.isArray(record.canonicalSentenceIds) && !sameSet(record.canonicalSentenceIds, beat.sentence_ids)) {
        errors.push(`${beat.id} narration record ${record.id} covers ${record.canonicalSentenceIds.join(",")} but the beat declares ${beat.sentence_ids.join(",")}`);
      }
    }
    try {
      const seconds = segmentNarrationSeconds(segment, records, "en");
      if (seconds > NARRATION_CEILING_SECONDS) {
        errors.push(`${segment.id} narration is ${seconds}s, over the ${NARRATION_CEILING_SECONDS}s ceiling`);
      } else if (seconds > NARRATION_TARGET_SECONDS) {
        warnings.push(`${segment.id} narration is ${seconds}s, above the ${NARRATION_TARGET_SECONDS}s target`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  const expected = canonicalSentenceOrder(canonical);
  if (covered.join("\n") !== expected.join("\n")) {
    const missing = expected.filter((id) => !covered.includes(id));
    const extra = covered.filter((id) => !expected.includes(id));
    const duplicates = covered.filter((id, index) => covered.indexOf(id) !== index);
    errors.push(`sentence coverage must equal the canonical order exactly (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}; duplicates: ${duplicates.join(", ") || "none"})`);
  }
  return { valid: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 4: Write the CLI**

```js
// scripts/validate-segments.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSegmentBundle, segmentNarrationSeconds, validateSegments } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const bundle = await loadSegmentBundle(repositoryRoot);
  const result = validateSegments(bundle);
  const errors = [...result.errors];
  for (const segment of bundle.segments.segments) {
    let seconds = "n/a";
    try {
      seconds = `${segmentNarrationSeconds(segment, bundle.records, "en").toFixed(1)}s`;
    } catch {
      seconds = "unbound";
    }
    console.log(`${String(segment.number).padStart(2, "0")}  ${segment.id.padEnd(26)} ${seconds}`);
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    process.exit(1);
  }
  const sentenceCount = bundle.canonical.modules.reduce((sum, module) => sum + module.canonical_sentences.length, 0);
  console.log(`segments valid: ${bundle.segments.segments.length} segments cover ${sentenceCount} canonical sentences`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/v2-segments.test.mjs`
Expected: 4 pass, 1 fail. The failing test is "the repository segments validate", with `ENOENT ... content/segments/ci-phase0-v0.1.0.segments.json`, because the data file is authored in Task 3.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/segments.mjs scripts/validate-segments.mjs tests/v2-segments.test.mjs
git commit -m "feat: add segment model library and validator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Author the five segments and the English label pack

**Files:**
- Create: `content/segments/ci-phase0-v0.1.0.segments.json`
- Create: `content/translations/en/ci-phase0-v0.1.0.json`

**Interfaces:**
- Consumes: the shape from Task 2; narration records `wound-day2`, `wound-paths`, `wound-milestones`, `call-three-signs`, `call-any`, `call-numbers` in `assets/audio/draft/manifest.json` and `healing`, `chaptered-programming`, `follow-up` in `assets/audio/manifest.json`.
- Produces: the segment file every later task reads, and the English label keys that Task 5 validates: `guide.title`, `guide.subtitle`, `seg.<slug>.title`, `seg.<slug>.chip`, and the `ui.*` keys listed in Task 5.

- [ ] **Step 1: Write the segments file**

```json
{
  "schema_version": "1.0",
  "artifact_id": "ci-phase0",
  "artifact_version": "0.1.0",
  "status": "unverified_draft",
  "patient_use": false,
  "notice": "UNVERIFIED — NOT FOR PATIENT USE",
  "canvas": { "width": 1080, "height": 1920, "fps": 30, "title_card_seconds": 1.5, "beat_gap_seconds": 0.6, "tail_seconds": 0.9 },
  "segments": [
    {
      "id": "seg/incision-day2",
      "number": 1,
      "title_key": "seg.incision-day2.title",
      "chip_key": "seg.incision-day2.chip",
      "beats": [
        {
          "id": "beat/dressing-off",
          "sentence_ids": ["wc.01", "wc.02"],
          "frame": "frame-01",
          "narration": { "en": { "manifest": "assets/audio/draft/manifest.json", "record_id": "wound-day2" } }
        },
        {
          "id": "beat/two-paths",
          "sentence_ids": ["wc.03", "wc.04", "wc.05", "wc.06", "wc.07"],
          "frame": "frame-0203-paths",
          "narration": { "en": { "manifest": "assets/audio/draft/manifest.json", "record_id": "wound-paths" } }
        }
      ]
    },
    {
      "id": "seg/next-two-weeks",
      "number": 2,
      "title_key": "seg.next-two-weeks.title",
      "chip_key": "seg.next-two-weeks.chip",
      "data_fields": ["follow_up_date"],
      "beats": [
        {
          "id": "beat/milestones",
          "sentence_ids": ["wc.08", "wc.09", "wc.10"],
          "frame": "frame-0405-milestones",
          "narration": { "en": { "manifest": "assets/audio/draft/manifest.json", "record_id": "wound-milestones" } }
        },
        {
          "id": "beat/medication-antibiotic",
          "condition": "antibiotic",
          "status": "pending_clinician_text",
          "sentence_ids": [],
          "frame": "frame-medication-pending",
          "narration": {}
        },
        {
          "id": "beat/medication-pain",
          "condition": "pain_medication",
          "status": "pending_clinician_text",
          "sentence_ids": [],
          "frame": "frame-medication-pending",
          "narration": {}
        }
      ]
    },
    {
      "id": "seg/when-to-call",
      "number": 3,
      "title_key": "seg.when-to-call.title",
      "chip_key": "seg.when-to-call.chip",
      "beats": [
        {
          "id": "beat/three-signs",
          "sentence_ids": ["call.01", "call.01a", "call.01b", "call.01c"],
          "frame": "frame-06-redness",
          "narration": { "en": { "manifest": "assets/audio/draft/manifest.json", "record_id": "call-three-signs" } }
        },
        {
          "id": "beat/any-of-these",
          "sentence_ids": ["call.02", "call.03", "call.04", "call.05"],
          "frame": "frame-0710-anylist",
          "narration": { "en": { "manifest": "assets/audio/draft/manifest.json", "record_id": "call-any" } }
        }
      ]
    },
    {
      "id": "seg/who-to-call",
      "number": 4,
      "title_key": "seg.who-to-call.title",
      "chip_key": "seg.who-to-call.chip",
      "beats": [
        {
          "id": "beat/numbers",
          "sentence_ids": ["call.06", "call.07", "call.07a", "call.08"],
          "frame": "frame-11-numbers",
          "narration": { "en": { "manifest": "assets/audio/draft/manifest.json", "record_id": "call-numbers" } }
        }
      ]
    },
    {
      "id": "seg/programming-visits",
      "number": 5,
      "title_key": "seg.programming-visits.title",
      "chip_key": "seg.programming-visits.chip",
      "beats": [
        {
          "id": "beat/healing",
          "sentence_ids": ["act.01"],
          "frame": "frame-12-healing",
          "narration": { "en": { "manifest": "assets/audio/manifest.json", "record_id": "healing" } }
        },
        {
          "id": "beat/programming",
          "sentence_ids": ["act.02", "act.03"],
          "frame": "frame-13-programming",
          "narration": { "en": { "manifest": "assets/audio/manifest.json", "record_id": "chaptered-programming" } }
        },
        {
          "id": "beat/follow-up",
          "sentence_ids": ["act.04", "act.05"],
          "frame": "frame-14-follow-up",
          "narration": { "en": { "manifest": "assets/audio/manifest.json", "record_id": "follow-up" } }
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the English label pack**

```json
{
  "schema_version": "1.0",
  "language": "en",
  "script": "Latn",
  "artifact_id": "ci-phase0",
  "artifact_version": "0.1.0",
  "status": "source",
  "patient_use": false,
  "notice": "UNVERIFIED — NOT FOR PATIENT USE",
  "sentences_source": "canonical",
  "labels": {
    "guide.title": "Your cochlear implant recovery guide",
    "guide.subtitle": "Five short videos. Start with the one you are wondering about.",
    "seg.incision-day2.title": "Day 2: bandage off, tape or no tape",
    "seg.incision-day2.chip": "Day 2",
    "seg.next-two-weeks.title": "The next two weeks: shower, your medicines, your wound check",
    "seg.next-two-weeks.chip": "Day 3 to 2 weeks",
    "seg.when-to-call.title": "When to call: the signs",
    "seg.when-to-call.chip": "Any day",
    "seg.who-to-call.title": "Who to call: the numbers",
    "seg.who-to-call.chip": "Any day",
    "seg.programming-visits.title": "After healing: programming visits",
    "seg.programming-visits.chip": "After healing",
    "ui.play": "Play",
    "ui.pause": "Pause",
    "ui.next": "Next",
    "ui.previous": "Previous",
    "ui.subtitles": "Subtitles",
    "ui.language": "Language",
    "ui.speed": "Speed",
    "ui.contents": "Contents",
    "ui.card": "Printable card",
    "ui.notice": "Private prototype. Not for patient use.",
    "ui.pending_clinician_text": "Medication details are pending your surgeon's wording.",
    "ui.follow_up_default": "about two weeks after surgery"
  },
  "review": { "kind": "source", "label": "English source text", "date": "2026-09-17", "receipt": null }
}
```

- [ ] **Step 3: Run the validator and the segment tests**

Run: `node scripts/validate-segments.mjs && node --test tests/v2-segments.test.mjs`
Expected: a five-line table with narration seconds of roughly 25.8, 11.1, 28.7, 24.0, 23.0, the line `segments valid: 5 segments cover 27 canonical sentences`, and `# pass 5`.

- [ ] **Step 4: Commit**

```bash
git add content/segments/ci-phase0-v0.1.0.segments.json content/translations/en/ci-phase0-v0.1.0.json
git commit -m "feat: author five recovery segments and the English label pack

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Segment timeline and WebVTT derivation

**Files:**
- Create: `scripts/lib/segment-timeline.mjs`
- Test: `tests/v2-segment-timeline.test.mjs`

**Interfaces:**
- Consumes: `resolveRecord`, `loadSegmentBundle` from Task 2; `speechEndSeconds`, `wordTimings` from Task 1.
- Produces: `buildSegmentTimeline({ segments, segment, records, language = "en", maxWordsPerCue = 8, audioFile = null }) -> timeline`, `groupCues(beatWords, beatId, maxWordsPerCue, startIndex) -> cues`, `vttTime(seconds) -> "HH:MM:SS.mmm"`, `toWebVtt(cues) -> string`.
- Timeline shape: `{ schema_version: "1.0", segment_id, number, language, canvas: { width, height, fps }, title_card: { start: 0, end }, beat_gap_seconds, tail_seconds, audio_file, beats: [{ id, frame, sentence_ids, start, end, speech_seconds, record_id, manifest, source_audio, text }], words: [{ text, start, end, beat }], cues: [{ id, start, end, text, beat }], narration_seconds, duration_seconds, source_records: { [record_id]: sha256 } }`. Times are segment-local seconds rounded to 3 decimals. Conditional beats without narration in the requested language are omitted.

- [ ] **Step 1: Write the failing test**

```js
// tests/v2-segment-timeline.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { loadSegmentBundle } from "../scripts/lib/segments.mjs";
import { buildSegmentTimeline, groupCues, toWebVtt, vttTime } from "../scripts/lib/segment-timeline.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const segmentOne = bundle.segments.segments[0];
const segmentTwo = bundle.segments.segments[1];

test("segment one starts after the title card and spaces beats by the gap", () => {
  const timeline = buildSegmentTimeline({ segments: bundle.segments, segment: segmentOne, records: bundle.records });
  assert.equal(timeline.title_card.end, 1.5);
  assert.equal(timeline.beats.length, 2);
  assert.equal(timeline.beats[0].start, 1.5);
  assert.equal(timeline.beats[0].end, Number((1.5 + timeline.beats[0].speech_seconds).toFixed(3)));
  assert.equal(timeline.beats[1].start, Number((timeline.beats[0].end + 0.6).toFixed(3)));
  assert.equal(timeline.duration_seconds, Number((timeline.beats[1].end + 0.9).toFixed(3)));
  assert.equal(timeline.words[0].text, "Two");
  assert.equal(timeline.words[0].start, 1.5);
  assert.ok(timeline.words.every((word, index) => index === 0 || word.start >= timeline.words[index - 1].start));
  assert.ok(timeline.narration_seconds <= 35);
  assert.equal(typeof timeline.source_records["wound-day2"], "string");
});

test("every word lands in exactly one cue and cues never overlap", () => {
  const timeline = buildSegmentTimeline({ segments: bundle.segments, segment: segmentOne, records: bundle.records });
  for (const beat of timeline.beats) {
    const words = timeline.words.filter((word) => word.beat === beat.id).map((word) => word.text).join(" ");
    const cueText = timeline.cues.filter((cue) => cue.beat === beat.id).map((cue) => cue.text).join(" ");
    assert.equal(cueText, words);
    assert.equal(cueText, beat.text.split(/\s+/).join(" "));
  }
  for (let index = 1; index < timeline.cues.length; index += 1) {
    assert.ok(timeline.cues[index].start >= timeline.cues[index - 1].end, timeline.cues[index].id);
  }
  assert.ok(timeline.cues.every((cue) => cue.text.split(" ").length <= 8));
  assert.equal(timeline.cues[0].id, "cue-01");
});

test("conditional beats without narration are omitted from the timeline", () => {
  const timeline = buildSegmentTimeline({ segments: bundle.segments, segment: segmentTwo, records: bundle.records, audioFile: "assets/audio/v2/en/next-two-weeks.mp3" });
  assert.deepEqual(timeline.beats.map((beat) => beat.id), ["beat/milestones"]);
  assert.equal(timeline.audio_file, "assets/audio/v2/en/next-two-weeks.mp3");
});

test("cue grouping breaks on sentence punctuation and the word limit", () => {
  const words = "One two three. Four five six seven eight nine ten eleven".split(" ").map((text, index) => ({ text, start: index, end: index + 0.5, beat: "b" }));
  const cues = groupCues(words, "b", 8, 0);
  assert.deepEqual(cues.map((cue) => cue.text), ["One two three.", "Four five six seven eight nine ten eleven"]);
  assert.equal(cues[1].id, "cue-02");
});

test("WebVTT output is well formed", () => {
  assert.equal(vttTime(1.5), "00:00:01.500");
  assert.equal(vttTime(3661.0421), "01:01:01.042");
  const timeline = buildSegmentTimeline({ segments: bundle.segments, segment: segmentOne, records: bundle.records });
  const vtt = toWebVtt(timeline.cues);
  assert.match(vtt, /^WEBVTT\n\n1\n00:00:01\.500 --> 00:00:/);
  assert.ok(vtt.endsWith("\n"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v2-segment-timeline.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/segment-timeline.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/segment-timeline.mjs
import { createHash } from "node:crypto";

import { resolveRecord } from "./segments.mjs";
import { speechEndSeconds, wordTimings } from "./narration-timing.mjs";

const CUE_BREAK = /[.;:!?…]$|—$/;
const round = (value) => Number(value.toFixed(3));

function recordHash(record) {
  return createHash("sha256").update(JSON.stringify({ text: record.text, timestamps: record.timestamps })).digest("hex");
}

export function groupCues(beatWords, beatId, maxWordsPerCue, startIndex) {
  const cues = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    cues.push({
      id: `cue-${String(startIndex + cues.length + 1).padStart(2, "0")}`,
      start: current[0].start,
      end: current.at(-1).end,
      text: current.map((word) => word.text).join(" "),
      beat: beatId
    });
    current = [];
  };
  for (const word of beatWords) {
    current.push(word);
    if (current.length >= maxWordsPerCue || CUE_BREAK.test(word.text)) flush();
  }
  flush();
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].start < cues[index - 1].end) cues[index].start = cues[index - 1].end;
  }
  return cues;
}

export function buildSegmentTimeline({ segments, segment, records, language = "en", maxWordsPerCue = 8, audioFile = null }) {
  const canvas = segments.canvas;
  const titleCard = { start: 0, end: round(canvas.title_card_seconds) };
  let clock = titleCard.end;
  const beats = [];
  const words = [];
  const cues = [];
  const sourceRecords = {};
  for (const beat of segment.beats) {
    const binding = beat.narration?.[language];
    if (!binding) continue;
    const record = resolveRecord(records, binding);
    if (!record) throw new Error(`${beat.id} references missing narration record ${binding.record_id}`);
    const speechSeconds = round(speechEndSeconds(record));
    const start = round(clock);
    const end = round(start + speechSeconds);
    const beatWords = wordTimings(record).map((word) => ({
      text: word.text,
      start: round(start + word.start),
      end: round(start + word.end),
      beat: beat.id
    }));
    words.push(...beatWords);
    cues.push(...groupCues(beatWords, beat.id, maxWordsPerCue, cues.length));
    beats.push({
      id: beat.id,
      frame: beat.frame,
      sentence_ids: [...beat.sentence_ids],
      start,
      end,
      speech_seconds: speechSeconds,
      record_id: record.id,
      manifest: binding.manifest,
      source_audio: record.file,
      text: record.text
    });
    sourceRecords[record.id] = recordHash(record);
    clock = end + canvas.beat_gap_seconds;
  }
  const lastEnd = beats.length ? beats.at(-1).end : titleCard.end;
  return {
    schema_version: "1.0",
    segment_id: segment.id,
    number: segment.number,
    language,
    canvas: { width: canvas.width, height: canvas.height, fps: canvas.fps },
    title_card: titleCard,
    beat_gap_seconds: canvas.beat_gap_seconds,
    tail_seconds: canvas.tail_seconds,
    audio_file: audioFile,
    beats,
    words,
    cues,
    narration_seconds: round(beats.reduce((sum, beat) => sum + beat.speech_seconds, 0)),
    duration_seconds: round(lastEnd + canvas.tail_seconds),
    source_records: sourceRecords
  };
}

export function vttTime(seconds) {
  const total = Math.round(seconds * 1000);
  const milliseconds = total % 1000;
  const wholeSeconds = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60000) % 60;
  const hours = Math.floor(total / 3600000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)}.${String(milliseconds).padStart(3, "0")}`;
}

export function toWebVtt(cues) {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue, index) => {
    lines.push(String(index + 1), `${vttTime(cue.start)} --> ${vttTime(cue.end)}`, cue.text, "");
  });
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/v2-segment-timeline.test.mjs`
Expected: `# pass 5`

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/segment-timeline.mjs tests/v2-segment-timeline.test.mjs
git commit -m "feat: derive segment timelines and WebVTT cues from narration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Language pack library and validator

**Files:**
- Create: `scripts/lib/language-packs.mjs`
- Create: `scripts/validate-translations.mjs`
- Test: `tests/v2-language-packs.test.mjs`

**Interfaces:**
- Consumes: `canonicalSentenceOrder`, `loadSegmentBundle` from Task 2; the English pack from Task 3.
- Produces: `UI_LABEL_KEYS`, `TRANSLATION_STATUSES`, `requiredLabelKeys(segments) -> string[]`, `digitTokens(text) -> string[]`, `canonicalSentenceText(canonical) -> Map`, `validateLanguagePack({ pack, canonical, segments }) -> { valid, errors }`, `resolveSentences({ pack, canonical }) -> Map<id, text>`. Slice 4 authors `es` and `zh-Hans` packs against exactly these rules: `sentences` covers every canonical ID, digit tokens (phone numbers, `101.5`, `12`) survive translation with `,` accepted as a decimal separator, `status` is one of `machine_draft | ai_reviewed | human_reviewed`, and `review.label` is present.

- [ ] **Step 1: Write the failing test**

```js
// tests/v2-language-packs.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadSegmentBundle } from "../scripts/lib/segments.mjs";
import {
  canonicalSentenceText,
  digitTokens,
  requiredLabelKeys,
  resolveSentences,
  validateLanguagePack
} from "../scripts/lib/language-packs.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const englishPack = JSON.parse(await readFile(resolve(root, "content/translations/en/ci-phase0-v0.1.0.json"), "utf8"));

function spanishFixture() {
  const sentences = Object.fromEntries([...canonicalSentenceText(bundle.canonical)].map(([id, text]) => [id, `ES ${text}`]));
  return {
    schema_version: "1.0",
    language: "es",
    script: "Latn",
    artifact_id: "ci-phase0",
    artifact_version: "0.1.0",
    status: "machine_draft",
    patient_use: false,
    sentences,
    labels: Object.fromEntries(Object.keys(englishPack.labels).map((key) => [key, `ES ${englishPack.labels[key]}`])),
    review: { kind: "ai", label: "AI Spanish reviewer (Claude), not a certified medical translator", date: "2026-09-17", receipt: null }
  };
}

test("the English pack is valid and resolves sentences from canonical", () => {
  const result = validateLanguagePack({ pack: englishPack, canonical: bundle.canonical, segments: bundle.segments });
  assert.deepEqual(result.errors, []);
  const sentences = resolveSentences({ pack: englishPack, canonical: bundle.canonical });
  assert.equal(sentences.get("wc.01"), "Two days after surgery, remove the mastoid dressing, or head bandage.");
  assert.ok(requiredLabelKeys(bundle.segments).includes("seg.incision-day2.title"));
});

test("English packs must not copy canonical sentences", () => {
  const copy = { ...englishPack, sentences: { "wc.01": "copied" } };
  assert.match(validateLanguagePack({ pack: copy, canonical: bundle.canonical, segments: bundle.segments }).errors.join("\n"), /must not copy/);
});

test("translated packs need every sentence, every label, a status, and a review label", () => {
  const pack = spanishFixture();
  assert.deepEqual(validateLanguagePack({ pack, canonical: bundle.canonical, segments: bundle.segments }).errors, []);
  delete pack.sentences["call.03"];
  delete pack.labels["ui.play"];
  pack.status = "done";
  pack.review = {};
  const errors = validateLanguagePack({ pack, canonical: bundle.canonical, segments: bundle.segments }).errors.join("\n");
  assert.match(errors, /missing sentence call\.03/);
  assert.match(errors, /missing label ui\.play/);
  assert.match(errors, /status must be one of/);
  assert.match(errors, /review\.label is required/);
});

test("protected digits must survive translation, with a comma decimal allowed", () => {
  assert.deepEqual(digitTokens("Call 415-353-2148 within 12 hours above 101,5"), ["415-353-2148", "12", "101.5"]);
  const lost = spanishFixture();
  lost.sentences["call.02"] = "Llame si tiene fiebre alta.";
  assert.match(validateLanguagePack({ pack: lost, canonical: bundle.canonical, segments: bundle.segments }).errors.join("\n"), /call\.02 lost protected value 101\.5/);
  const comma = spanishFixture();
  comma.sentences["call.02"] = "Llame si tiene fiebre de más de 101,5 grados Fahrenheit.";
  assert.deepEqual(validateLanguagePack({ pack: comma, canonical: bundle.canonical, segments: bundle.segments }).errors, []);
  const unknown = spanishFixture();
  unknown.sentences["zz.99"] = "extra";
  assert.match(validateLanguagePack({ pack: unknown, canonical: bundle.canonical, segments: bundle.segments }).errors.join("\n"), /unknown sentence zz\.99/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v2-language-packs.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/language-packs.mjs'`

- [ ] **Step 3: Write the library**

```js
// scripts/lib/language-packs.mjs
import { canonicalSentenceOrder } from "./segments.mjs";

export const UI_LABEL_KEYS = Object.freeze([
  "guide.title",
  "guide.subtitle",
  "ui.play",
  "ui.pause",
  "ui.next",
  "ui.previous",
  "ui.subtitles",
  "ui.language",
  "ui.speed",
  "ui.contents",
  "ui.card",
  "ui.notice",
  "ui.pending_clinician_text",
  "ui.follow_up_default"
]);

export const TRANSLATION_STATUSES = Object.freeze(["machine_draft", "ai_reviewed", "human_reviewed"]);

export function requiredLabelKeys(segments) {
  return [...UI_LABEL_KEYS, ...segments.segments.flatMap((segment) => [segment.title_key, segment.chip_key])];
}

export function digitTokens(text) {
  return (text.match(/\d+(?:[.,]\d+)?(?:-\d+)*/g) ?? []).map((token) => token.replace(",", "."));
}

export function canonicalSentenceText(canonical) {
  return new Map(canonical.modules.flatMap((module) => module.canonical_sentences.map((sentence) => [sentence.id, sentence.text])));
}

export function validateLanguagePack({ pack, canonical, segments }) {
  const errors = [];
  if (typeof pack?.language !== "string" || !pack.language) errors.push("language is required");
  if (pack?.artifact_id !== canonical.artifact.id || pack?.artifact_version !== canonical.artifact.version) {
    errors.push("pack must reference the canonical artifact id and version");
  }
  const labels = pack?.labels ?? {};
  for (const key of requiredLabelKeys(segments)) {
    if (typeof labels[key] !== "string" || !labels[key].trim()) errors.push(`missing label ${key}`);
  }
  if (pack?.language === "en") {
    if (pack.sentences_source !== "canonical") errors.push("the English pack must declare sentences_source canonical");
    if (pack.sentences) errors.push("the English pack must not copy canonical sentences");
    return { valid: errors.length === 0, errors };
  }
  const canonicalText = canonicalSentenceText(canonical);
  const sentences = pack?.sentences ?? {};
  for (const id of canonicalSentenceOrder(canonical)) {
    const text = sentences[id];
    if (typeof text !== "string" || !text.trim()) {
      errors.push(`missing sentence ${id}`);
      continue;
    }
    const actual = digitTokens(text);
    for (const token of digitTokens(canonicalText.get(id))) {
      if (!actual.includes(token)) errors.push(`sentence ${id} lost protected value ${token}`);
    }
  }
  for (const id of Object.keys(sentences)) {
    if (!canonicalText.has(id)) errors.push(`unknown sentence ${id}`);
  }
  if (!TRANSLATION_STATUSES.includes(pack?.status)) errors.push(`status must be one of ${TRANSLATION_STATUSES.join(", ")}`);
  if (!pack?.review?.label) errors.push("review.label is required so the UI can show who reviewed the translation");
  return { valid: errors.length === 0, errors };
}

export function resolveSentences({ pack, canonical }) {
  if (pack.language === "en") return canonicalSentenceText(canonical);
  return new Map(Object.entries(pack.sentences ?? {}));
}
```

- [ ] **Step 4: Write the CLI**

```js
// scripts/validate-translations.mjs
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateLanguagePack } from "./lib/language-packs.mjs";
import { loadSegmentBundle } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function loadLanguagePacks(root, artifactFile = "ci-phase0-v0.1.0.json") {
  const base = join(root, "content/translations");
  const entries = await readdir(base, { withFileTypes: true });
  const languages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const packs = [];
  for (const language of languages) {
    const path = `content/translations/${language}/${artifactFile}`;
    packs.push({ language, path, pack: JSON.parse(await readFile(join(root, path), "utf8")) });
  }
  return packs;
}

async function main() {
  const bundle = await loadSegmentBundle(repositoryRoot);
  const packs = await loadLanguagePacks(repositoryRoot);
  if (!packs.some((entry) => entry.pack.language === "en")) {
    console.error("error: the English pack content/translations/en is required");
    process.exit(1);
  }
  let failed = false;
  for (const { language, path, pack } of packs) {
    const errors = [...validateLanguagePack({ pack, canonical: bundle.canonical, segments: bundle.segments }).errors];
    if (pack.language !== language) errors.push(`language ${pack.language} does not match directory ${language}`);
    if (errors.length) {
      failed = true;
      for (const error of errors) console.error(`error: ${path}: ${error}`);
    } else {
      console.log(`${path}: valid (${pack.language}, ${pack.status})`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

- [ ] **Step 5: Run the test and the CLI**

Run: `node --test tests/v2-language-packs.test.mjs && node scripts/validate-translations.mjs`
Expected: `# pass 4` and `content/translations/en/ci-phase0-v0.1.0.json: valid (en, source)`

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/language-packs.mjs scripts/validate-translations.mjs tests/v2-language-packs.test.mjs
git commit -m "feat: validate language packs against canonical sentences

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Segment media builder (timelines, captions, concatenated audio) and the media freshness check

**Files:**
- Create: `scripts/lib/segment-audio.mjs`
- Create: `scripts/build-segment-media.mjs`
- Modify: `scripts/validate-segments.mjs` (add `--media`)
- Create (generated): `assets/captions/v2/index.json`, `assets/captions/v2/en/<slug>.timeline.json`, `assets/captions/v2/en/<slug>.vtt`, `assets/audio/v2/en/<slug>.mp3` for the five slugs `incision-day2`, `next-two-weeks`, `when-to-call`, `who-to-call`, `programming-visits`
- Test: `tests/v2-segment-media.test.mjs`

**Interfaces:**
- Consumes: `buildSegmentTimeline`, `toWebVtt` from Task 4; `loadSegmentBundle`, `segmentSlug`, `validateSegments` from Task 2.
- Produces: `timelineElements(timeline) -> [{ kind: "silence" | "track", seconds, file?, beat? }]`, `buildConcatCommand({ timeline, root, outputPath }) -> { args, elements }`, `renderSegmentAudio({ timeline, root, outputPath, ffmpeg }) -> outputPath`, `probeDurationSeconds(path, ffprobe) -> number`, `mediaPaths(segment, language) -> { timeline, vtt, audio }`, `languagesWithNarration(segments) -> string[]`, `buildMediaPlan(bundle) -> [{ language, segment, paths, timeline, vtt }]`, `buildMediaIndex(plan) -> index`, `buildSegmentMedia({ root, audio }) -> { written, audioSkipped }`. The player in slice 2 reads `assets/captions/v2/index.json` entries `{ segment_id, number, language, timeline, captions, audio, duration_seconds, narration_seconds }`.

- [ ] **Step 1: Write the failing test**

```js
// tests/v2-segment-media.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadSegmentBundle } from "../scripts/lib/segments.mjs";
import { buildConcatCommand, probeDurationSeconds, renderSegmentAudio, timelineElements } from "../scripts/lib/segment-audio.mjs";
import { buildMediaIndex, buildMediaPlan, languagesWithNarration, mediaPaths } from "../scripts/build-segment-media.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

test("the media plan covers every segment for every narrated language", () => {
  assert.deepEqual(languagesWithNarration(bundle.segments), ["en"]);
  const plan = buildMediaPlan(bundle);
  assert.equal(plan.length, 5);
  assert.deepEqual(mediaPaths(bundle.segments.segments[0], "en"), {
    timeline: "assets/captions/v2/en/incision-day2.timeline.json",
    vtt: "assets/captions/v2/en/incision-day2.vtt",
    audio: "assets/audio/v2/en/incision-day2.mp3"
  });
  assert.equal(plan[0].timeline.audio_file, "assets/audio/v2/en/incision-day2.mp3");
  assert.match(plan[0].vtt, /^WEBVTT/);
  const index = buildMediaIndex(plan);
  assert.equal(index.entries.length, 5);
  assert.equal(index.entries[3].segment_id, "seg/who-to-call");
  assert.equal(index.entries[3].captions, "assets/captions/v2/en/who-to-call.vtt");
});

test("the concat command mirrors the timeline: title silence, trimmed tracks, gaps, tail", () => {
  const { timeline } = buildMediaPlan(bundle)[0];
  const elements = timelineElements(timeline);
  assert.deepEqual(elements.map((element) => element.kind), ["silence", "track", "silence", "track", "silence"]);
  assert.equal(elements[0].seconds, 1.5);
  assert.equal(elements[2].seconds, 0.6);
  assert.equal(elements[4].seconds, 0.9);
  assert.equal(elements[1].seconds, timeline.beats[0].speech_seconds);
  const { args } = buildConcatCommand({ timeline, root, outputPath: "/tmp/out.mp3" });
  const filter = args[args.indexOf("-filter_complex") + 1];
  assert.match(filter, /concat=n=5:v=0:a=1\[out\]/);
  assert.match(filter, new RegExp(`atrim=0:${timeline.beats[0].speech_seconds.toFixed(3)}`));
  assert.ok(args.includes(join(root, "assets/audio/draft/wound-day2.mp3")));
  assert.equal(args.at(-1), "/tmp/out.mp3");
});

test("rendered audio matches the timeline duration", { skip: hasFfmpeg ? false : "ffmpeg is not installed" }, async () => {
  const { timeline } = buildMediaPlan(bundle)[1];
  const directory = await mkdtemp(join(tmpdir(), "segment-audio-"));
  const outputPath = join(directory, "next-two-weeks.mp3");
  await renderSegmentAudio({ timeline, root, outputPath });
  const duration = await probeDurationSeconds(outputPath);
  assert.ok(Math.abs(duration - timeline.duration_seconds) < 0.25, `${duration} vs ${timeline.duration_seconds}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v2-segment-media.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/segment-audio.mjs'`

- [ ] **Step 3: Write the audio library**

```js
// scripts/lib/segment-audio.mjs
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FORMAT = "aformat=sample_rates=44100:channel_layouts=mono";

export function timelineElements(timeline) {
  const elements = [{ kind: "silence", seconds: timeline.title_card.end - timeline.title_card.start }];
  timeline.beats.forEach((beat, index) => {
    elements.push({ kind: "track", file: beat.source_audio, seconds: beat.speech_seconds, beat: beat.id });
    const isLast = index === timeline.beats.length - 1;
    elements.push({ kind: "silence", seconds: isLast ? timeline.tail_seconds : timeline.beat_gap_seconds });
  });
  return elements.filter((element) => element.kind === "track" || element.seconds > 0);
}

export function buildConcatCommand({ timeline, root, outputPath }) {
  const elements = timelineElements(timeline);
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
  const chains = [];
  elements.forEach((element, index) => {
    if (element.kind === "silence") {
      args.push("-f", "lavfi", "-t", element.seconds.toFixed(3), "-i", "anullsrc=r=44100:cl=mono");
      chains.push(`[${index}:a]${FORMAT}[a${index}]`);
    } else {
      args.push("-i", join(root, element.file));
      chains.push(`[${index}:a]atrim=0:${element.seconds.toFixed(3)},asetpts=PTS-STARTPTS,${FORMAT}[a${index}]`);
    }
  });
  const concat = `${elements.map((_, index) => `[a${index}]`).join("")}concat=n=${elements.length}:v=0:a=1[out]`;
  args.push("-filter_complex", `${chains.join(";")};${concat}`, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "4", outputPath);
  return { args, elements };
}

export async function renderSegmentAudio({ timeline, root, outputPath, ffmpeg = "ffmpeg" }) {
  const { args } = buildConcatCommand({ timeline, root, outputPath });
  await execFileAsync(ffmpeg, args);
  return outputPath;
}

export async function probeDurationSeconds(path, ffprobe = "ffprobe") {
  const { stdout } = await execFileAsync(ffprobe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path
  ]);
  return Number(stdout.trim());
}
```

- [ ] **Step 4: Write the builder CLI**

```js
// scripts/build-segment-media.mjs
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderSegmentAudio } from "./lib/segment-audio.mjs";
import { buildSegmentTimeline, toWebVtt } from "./lib/segment-timeline.mjs";
import { loadSegmentBundle, segmentSlug, validateSegments } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MEDIA_INDEX_PATH = "assets/captions/v2/index.json";

export function mediaPaths(segment, language) {
  const slug = segmentSlug(segment.id);
  return {
    timeline: `assets/captions/v2/${language}/${slug}.timeline.json`,
    vtt: `assets/captions/v2/${language}/${slug}.vtt`,
    audio: `assets/audio/v2/${language}/${slug}.mp3`
  };
}

export function languagesWithNarration(segments) {
  const languages = new Set();
  for (const segment of segments.segments) {
    for (const beat of segment.beats) {
      for (const language of Object.keys(beat.narration ?? {})) languages.add(language);
    }
  }
  return [...languages].sort();
}

export function buildMediaPlan(bundle) {
  const plan = [];
  for (const language of languagesWithNarration(bundle.segments)) {
    for (const segment of bundle.segments.segments) {
      const paths = mediaPaths(segment, language);
      const timeline = buildSegmentTimeline({ segments: bundle.segments, segment, records: bundle.records, language, audioFile: paths.audio });
      plan.push({ language, segment, paths, timeline, vtt: toWebVtt(timeline.cues) });
    }
  }
  return plan;
}

export function buildMediaIndex(plan) {
  return {
    schema_version: "1.0",
    generated_by: "scripts/build-segment-media.mjs",
    patient_use: false,
    entries: plan.map((item) => ({
      segment_id: item.segment.id,
      number: item.segment.number,
      language: item.language,
      timeline: item.paths.timeline,
      captions: item.paths.vtt,
      audio: item.paths.audio,
      duration_seconds: item.timeline.duration_seconds,
      narration_seconds: item.timeline.narration_seconds
    }))
  };
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function buildSegmentMedia({ root = repositoryRoot, audio = true } = {}) {
  const bundle = await loadSegmentBundle(root);
  const validation = validateSegments(bundle);
  if (!validation.valid) throw new Error(`segments are invalid:\n${validation.errors.join("\n")}`);
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  const plan = buildMediaPlan(bundle);
  const written = [];
  for (const item of plan) {
    for (const [key, content] of [["timeline", serializeJson(item.timeline)], ["vtt", item.vtt]]) {
      const target = join(root, item.paths[key]);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
      written.push(item.paths[key]);
    }
    if (audio && hasFfmpeg) {
      const target = join(root, item.paths.audio);
      await mkdir(dirname(target), { recursive: true });
      await renderSegmentAudio({ timeline: item.timeline, root, outputPath: target });
      written.push(item.paths.audio);
    }
  }
  await writeFile(join(root, MEDIA_INDEX_PATH), serializeJson(buildMediaIndex(plan)));
  written.push(MEDIA_INDEX_PATH);
  return { written, audioSkipped: audio && !hasFfmpeg };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSegmentMedia({ audio: !process.argv.includes("--no-audio") });
  for (const path of result.written) console.log(path);
  if (result.audioSkipped) console.warn("ffmpeg is not installed; segment audio was not rendered.");
}
```

- [ ] **Step 5: Add the `--media` freshness check to the validator**

Replace the whole of `scripts/validate-segments.mjs` with:

```js
// scripts/validate-segments.mjs
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MEDIA_INDEX_PATH, buildMediaIndex, buildMediaPlan, serializeJson } from "./build-segment-media.mjs";
import { loadSegmentBundle, segmentNarrationSeconds, validateSegments } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function checkCommittedMedia(bundle, root) {
  const errors = [];
  const plan = buildMediaPlan(bundle);
  const expectedFiles = [
    ...plan.flatMap((item) => [[item.paths.timeline, serializeJson(item.timeline)], [item.paths.vtt, item.vtt]]),
    [MEDIA_INDEX_PATH, serializeJson(buildMediaIndex(plan))]
  ];
  for (const [path, expected] of expectedFiles) {
    let actual;
    try {
      actual = await readFile(join(root, path), "utf8");
    } catch {
      errors.push(`${path} is missing; run npm run segments:build`);
      continue;
    }
    if (actual !== expected) errors.push(`${path} is stale; run npm run segments:build`);
  }
  for (const item of plan) {
    try {
      await readFile(join(root, item.paths.audio));
    } catch {
      errors.push(`${item.paths.audio} is missing; run npm run segments:build with ffmpeg installed`);
    }
  }
  return errors;
}

async function main() {
  const checkMedia = process.argv.includes("--media");
  const bundle = await loadSegmentBundle(repositoryRoot);
  const result = validateSegments(bundle);
  const errors = [...result.errors];
  if (result.valid && checkMedia) errors.push(...(await checkCommittedMedia(bundle, repositoryRoot)));
  for (const segment of bundle.segments.segments) {
    let seconds = "n/a";
    try {
      seconds = `${segmentNarrationSeconds(segment, bundle.records, "en").toFixed(1)}s`;
    } catch {
      seconds = "unbound";
    }
    console.log(`${String(segment.number).padStart(2, "0")}  ${segment.id.padEnd(26)} ${seconds}`);
  }
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    process.exit(1);
  }
  const sentenceCount = bundle.canonical.modules.reduce((sum, module) => sum + module.canonical_sentences.length, 0);
  console.log(`segments valid: ${bundle.segments.segments.length} segments cover ${sentenceCount} canonical sentences${checkMedia ? "; committed media is current" : ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

- [ ] **Step 6: Run the tests, build the media, and run the freshness check**

Run: `node --test tests/v2-segment-media.test.mjs && node scripts/build-segment-media.mjs && node scripts/validate-segments.mjs --media`
Expected: `# pass 3`; sixteen written paths (five timelines, five VTTs, five MP3s, the index); then the table and `segments valid: 5 segments cover 27 canonical sentences; committed media is current`.

- [ ] **Step 7: Spot-check one output**

Run: `head -12 assets/captions/v2/en/who-to-call.vtt && ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 assets/audio/v2/en/who-to-call.mp3`
Expected: `WEBVTT`, cue 1 at `00:00:01.500`, and a duration within 0.25 s of the `duration_seconds` in `assets/captions/v2/en/who-to-call.timeline.json`.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/segment-audio.mjs scripts/build-segment-media.mjs scripts/validate-segments.mjs tests/v2-segment-media.test.mjs assets/captions/v2 assets/audio/v2
git commit -m "feat: build segment timelines, captions, and concatenated narration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Wire the checks into npm and document the content folders

**Files:**
- Modify: `package.json` (scripts block)
- Modify: `content/README.md` (append a section)

**Interfaces:**
- Consumes: the CLIs from Tasks 2, 5, and 6.
- Produces: `npm run segments:validate`, `npm run segments:build`, `npm run translations:validate`, and an extended `npm run check` that CI runs.

- [ ] **Step 1: Add the scripts**

In `package.json`, add three entries to `scripts` and extend `check` so the block reads:

```json
"check": "npm run content:validate && npm run copy:validate && npm run media:validate && npm run narration:validate && npm run activation:validate:contract && npm run segments:validate && npm run translations:validate && npm run activation:test",
"segments:validate": "node scripts/validate-segments.mjs --media",
"segments:build": "node scripts/build-segment-media.mjs",
"translations:validate": "node scripts/validate-translations.mjs",
```

Keep every other script unchanged. `activation:test` already runs `tests/*.test.mjs`, so the five new test files run under it.

- [ ] **Step 2: Document the folders**

Append to `content/README.md`:

```markdown
## v2 segments and language packs

`segments/ci-phase0-v0.1.0.segments.json` cuts the canonical sentences into five short segments for the v2 guide. Each beat binds sentence IDs to a frame id and to an existing narration record, so captions always reproduce the spoken text. Every canonical sentence appears in exactly one segment, in canonical order; `npm run segments:validate` enforces that, the 35-second narration ceiling, and that the derived files under `assets/captions/v2/` and `assets/audio/v2/` match the source. Rebuild them with `npm run segments:build`.

`translations/<language>/ci-phase0-v0.1.0.json` holds interface labels per language and, for languages other than English, one translated sentence per canonical ID. English resolves its sentences from `canonical/` and never copies them. `npm run translations:validate` checks coverage and that phone numbers and numeric thresholds survive translation. A validated translation is still a draft until the reviewer named in its `review.label` has passed it; AI review is never clinical approval.
```

- [ ] **Step 3: Run the full check**

Run: `npm run check 2>&1 | tail -15`
Expected: the segment table, `content/translations/en/ci-phase0-v0.1.0.json: valid (en, source)`, and `# pass 113` with `# fail 0` (93 existing tests plus 20 new ones).

- [ ] **Step 4: Commit**

```bash
git add package.json content/README.md
git commit -m "chore: run segment and translation validators in npm run check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage for slice one:** section 3 (five segments, 35 s ceiling, title card, beats as the unit) is Tasks 2 to 4; section 6's English pack and the validator rules that slices 4 reuses are Task 5; section 12 steps 1 and 3 are Tasks 4 and 6; section 13's "timestamps that do not cover the narration text: build fails" is Task 1; section 14's segment, translation, and VTT tests are Tasks 2, 5, 4, and 6; section 11's file layout for `content/segments`, `content/translations`, `assets/captions/v2`, `assets/audio/v2` is Tasks 3 and 6. Sections 4, 5, 7, 8, 9, 10 belong to later slices by design.
- **Placeholders:** none. Every step carries its code or its exact command and expected output.
- **Type consistency:** `loadSegmentBundle` returns `{ segments, canonical, records }` everywhere; `records` is a `Map` keyed `${manifest}#${record_id}`; `buildSegmentTimeline` takes `{ segments, segment, records, language, maxWordsPerCue, audioFile }` in Tasks 4 and 6; `mediaPaths` returns `{ timeline, vtt, audio }` in Task 6 and its test; `serializeJson`, `MEDIA_INDEX_PATH`, `buildMediaIndex`, `buildMediaPlan` are exported by `build-segment-media.mjs` and imported by the validator in Task 6 step 5.
