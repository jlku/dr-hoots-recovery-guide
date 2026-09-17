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
