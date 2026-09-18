import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export const FRAMES_PATH = "content/frames/ci-phase0-v0.1.0.frames.json";
export const FRAME_KINDS = Object.freeze(["svg", "image", "text", "composite", "panels"]);
export const MOTION_MODES = Object.freeze(["static", "narration"]);
export const OVERLAY_TYPES = Object.freeze(["tape-strip", "inset", "no-cleaning", "checklist", "rows", "steps", "pointer", "device", "flush", "motion-arrow"]);

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

function within(anchor) {
  return anchor && anchor.x >= 0 && anchor.x <= 1 && anchor.y >= 0 && anchor.y <= 1;
}

function validateOverlays(id, frame, overlays, { labels, spoken, errors }) {
  for (const overlay of overlays ?? []) {
    if (!OVERLAY_TYPES.includes(overlay.type)) errors.push(`${id} overlay ${overlay.id} has unsupported type ${overlay.type}`);
    for (const key of ["anchor", "coil"]) {
      if (overlay[key] && !frame.anchors?.[overlay[key]]) errors.push(`${id} overlay ${overlay.id} ${key} ${overlay[key]} is not defined`);
    }
    if (overlay.at && !within(overlay.at)) errors.push(`${id} overlay ${overlay.id} position must sit within the image`);
    const keys = [overlay.label_key, ...(overlay.rows ?? []).map((row) => row.label_key)].filter(Boolean);
    for (const key of keys) {
      if (typeof labels[key] !== "string" || !labels[key].trim()) errors.push(`${id} overlay ${overlay.id} label ${key} is not in the English pack`);
    }
    const sentenceIds = [...(overlay.sentence_ids ?? []), ...(overlay.rows ?? []).flatMap((row) => row.sentence_ids ?? [])];
    if (!sentenceIds.length) errors.push(`${id} overlay ${overlay.id} needs sentence_ids`);
    for (const sentenceId of sentenceIds) {
      if (!spoken.has(sentenceId)) errors.push(`${id} overlay ${overlay.id} sentence ${sentenceId} is not spoken by a beat that uses this frame`);
    }
  }
}

async function validateLayers(id, frame, { root, errors }) {
  const layers = frame.layers ?? {};
  if (!Object.keys(layers).length) errors.push(`${id} needs at least one layer`);
  for (const [name, file] of Object.entries(layers)) {
    if (!(await exists(join(root, file)))) errors.push(`${id} layer ${name} file ${file} does not exist`);
  }
  for (const [name, anchor] of Object.entries(frame.anchors ?? {})) {
    if (!within(anchor)) errors.push(`${id} anchor ${name} must sit within the image`);
  }
  if (typeof frame.alt !== "string" || !frame.alt.trim()) errors.push(`${id} needs alt text`);
  return layers;
}

async function validateComposite(id, frame, { root, labels, spoken, errors, motion }) {
  const layers = await validateLayers(id, frame, { root, errors });
  for (const state of frame.states ?? []) {
    if (!layers[state.image]) errors.push(`${id} state ${state.id} names layer ${state.image}, which is not a layer`);
  }
  if (motion === "static" && (frame.states ?? []).length > 1) errors.push(`${id} swaps ${frame.states.length} states during a beat, which the static version forbids; draw the motion as numbered panels`);
  validateOverlays(id, frame, frame.overlays, { labels, spoken, errors });
}

async function validatePanels(id, frame, { root, labels, spoken, errors }) {
  const layers = await validateLayers(id, frame, { root, errors });
  if (!frame.panels?.length) errors.push(`${id} needs panels`);
  const numbers = (frame.panels ?? []).map((panel) => panel.number).filter((number) => number != null);
  if (numbers.some((number, index) => number !== index + 1)) errors.push(`${id} panel numbers must run 1, 2, 3 in order`);
  for (const panel of frame.panels ?? []) {
    const name = `${id} panel ${panel.id}`;
    if (!layers[panel.image]) errors.push(`${name} names layer ${panel.image}, which is not a layer`);
    if (panel.zoom && !frame.anchors?.[panel.zoom.anchor]) errors.push(`${name} zoom anchor ${panel.zoom.anchor} is not defined`);
    if (!panel.sentence_ids?.length) errors.push(`${name} needs sentence_ids`);
    for (const sentenceId of panel.sentence_ids ?? []) {
      if (!spoken.has(sentenceId)) errors.push(`${name} sentence ${sentenceId} is not spoken by a beat that uses this frame`);
    }
    for (const key of [panel.label_key, panel.title_key, ...(panel.caption_keys ?? [])].filter(Boolean)) {
      if (typeof labels[key] !== "string" || !labels[key].trim()) errors.push(`${name} label ${key} is not in the English pack`);
    }
    for (const overlay of panel.overlays ?? []) {
      if (overlay.from || overlay.until) errors.push(`${name} overlay ${overlay.id} is timed, but a panel is static`);
    }
    validateOverlays(name, frame, panel.overlays, { labels, spoken, errors });
  }
}

export async function validateFrames({ frames, segments, root, labels = {} }) {
  const errors = [];
  const warnings = [];
  if (frames.patient_use !== false) errors.push("patient_use must be false");
  if (frames.artifact_id !== segments.artifact_id || frames.artifact_version !== segments.artifact_version) {
    errors.push("frames must reference the segments artifact id and version");
  }
  const motion = frames.motion ?? "static";
  if (!MOTION_MODES.includes(motion)) errors.push(`motion must be one of ${MOTION_MODES.join(", ")}`);
  const catalog = frames.frames ?? {};
  const used = new Set();
  const spokenBy = new Map();
  for (const segment of segments.segments ?? []) {
    for (const beat of segment.beats ?? []) {
      used.add(beat.frame);
      if (!catalog[beat.frame]) errors.push(`${beat.id} uses frame ${beat.frame}, which is not in the manifest`);
      spokenBy.set(beat.frame, [...(spokenBy.get(beat.frame) ?? []), ...(beat.sentence_ids ?? [])]);
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
    if (frame.kind === "composite") {
      await validateComposite(id, frame, { root, labels, spoken: new Set(spokenBy.get(id) ?? []), errors, motion });
      continue;
    }
    if (frame.kind === "panels") {
      await validatePanels(id, frame, { root, labels, spoken: new Set(spokenBy.get(id) ?? []), errors });
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
