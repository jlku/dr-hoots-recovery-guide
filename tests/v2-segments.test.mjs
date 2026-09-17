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
