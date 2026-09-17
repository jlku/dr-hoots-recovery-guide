// scripts/lib/frames.mjs
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export const FRAMES_PATH = "content/frames/ci-phase0-v0.1.0.frames.json";
export const FRAME_KINDS = Object.freeze(["svg", "image", "text"]);

export async function loadFrameManifest(root, path = FRAMES_PATH) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function validateFrames({ frames, segments, root }) {
  const errors = [];
  const warnings = [];
  if (frames.patient_use !== false) errors.push("patient_use must be false");
  if (frames.artifact_id !== segments.artifact_id || frames.artifact_version !== segments.artifact_version) {
    errors.push("frames must reference the segments artifact id and version");
  }
  const catalog = frames.frames ?? {};
  const used = new Set();
  for (const segment of segments.segments ?? []) {
    for (const beat of segment.beats ?? []) {
      used.add(beat.frame);
      if (!catalog[beat.frame]) errors.push(`${beat.id} uses frame ${beat.frame}, which is not in the manifest`);
    }
  }
  for (const [id, frame] of Object.entries(catalog)) {
    if (!FRAME_KINDS.includes(frame.kind)) {
      errors.push(`${id} has unsupported kind ${frame.kind}`);
      continue;
    }
    if (frame.kind === "text") {
      if (frame.src) errors.push(`${id} is a text frame and must not have src`);
      continue;
    }
    if (!frame.src) {
      errors.push(`${id} needs src`);
      continue;
    }
    if (typeof frame.alt !== "string" || !frame.alt.trim()) errors.push(`${id} needs alt text`);
    if (frame.kind === "svg" && !frame.src.endsWith(".svg")) errors.push(`${id} svg frames must point at an .svg file`);
    if (!(await exists(join(root, frame.src)))) errors.push(`${id} src ${frame.src} does not exist`);
  }
  for (const id of Object.keys(catalog)) {
    if (!used.has(id)) warnings.push(`${id} is not used by any beat`);
  }
  return { valid: errors.length === 0, errors, warnings };
}
