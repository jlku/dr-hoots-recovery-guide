// Instruction claims: every sentence that tells the patient to do something must name who, what,
// with what, where, and the end state, and must be a placeholder tied to an open clinician
// question until a picture shows the how.
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export const INSTRUCTIONS_PATH = "content/instructions/ci-phase0-v0.1.0.instructions.json";
export const QUESTIONS_PATH = "content/clinician/questions-for-song.md";
export const INSTRUCTION_STATUSES = Object.freeze(["placeholder", "text", "illustrated", "verified"]);
const FIELDS = Object.freeze(["actor", "action", "tool", "location", "end_state"]);

export async function loadInstructions(root, path = INSTRUCTIONS_PATH) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

export async function loadQuestions(root, path = QUESTIONS_PATH) {
  return parseQuestions(await readFile(join(root, path), "utf8"));
}

export function parseQuestions(markdown) {
  const questions = new Map();
  for (const match of markdown.matchAll(/^- `(q\.[a-z0-9-]+)` \((open|answered)/gm)) questions.set(match[1], { status: match[2] });
  return questions;
}

export function canonicalSentenceIds(canonical) {
  const ids = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if (typeof node.id === "string" && typeof node.text === "string") ids.push(node.id);
      Object.values(node).forEach(walk);
    }
  };
  walk(canonical);
  return ids;
}

export function pendingClaims(instructions, frameId) {
  return (instructions?.claims ?? []).filter((claim) => claim.frame === frameId && claim.status === "placeholder");
}

export async function validateInstructions({ instructions, canonical, segments, frames, questions, root = null }) {
  const errors = [];
  const warnings = [];
  if (instructions.patient_use !== false) errors.push("patient_use must be false");
  const sentenceIds = new Set(canonicalSentenceIds(canonical));
  const instructionIds = new Set(instructions.instruction_sentence_ids ?? []);
  const nonInstruction = instructions.non_instruction_sentence_ids ?? {};
  for (const id of sentenceIds) {
    const listed = instructionIds.has(id);
    const excused = Object.hasOwn(nonInstruction, id);
    if (!listed && !excused) errors.push(`${id} is neither an instruction nor excused with a reason`);
    if (listed && excused) errors.push(`${id} is listed both as an instruction and as a non-instruction`);
  }
  for (const id of [...instructionIds, ...Object.keys(nonInstruction)]) {
    if (!sentenceIds.has(id)) errors.push(`${id} is not a canonical sentence`);
  }
  for (const [id, reason] of Object.entries(nonInstruction)) {
    if (typeof reason !== "string" || !reason.trim()) errors.push(`${id} needs a reason for not being an instruction`);
  }
  const spokenBy = new Map();
  for (const segment of segments.segments ?? []) {
    for (const beat of segment.beats ?? []) spokenBy.set(beat.frame, new Set([...(spokenBy.get(beat.frame) ?? []), ...(beat.sentence_ids ?? [])]));
  }
  const claimed = new Map();
  const ids = new Set();
  for (const claim of instructions.claims ?? []) {
    if (ids.has(claim.id)) errors.push(`duplicate claim ${claim.id}`);
    ids.add(claim.id);
    for (const field of FIELDS) {
      if (typeof claim[field] !== "string" || !claim[field].trim()) errors.push(`${claim.id} needs ${field}`);
    }
    if (!INSTRUCTION_STATUSES.includes(claim.status)) errors.push(`${claim.id} has unsupported status ${claim.status}`);
    if (typeof claim.clinician_confirmed !== "boolean") errors.push(`${claim.id} needs clinician_confirmed true or false`);
    if (!claim.sentence_ids?.length) errors.push(`${claim.id} needs sentence_ids`);
    for (const id of claim.sentence_ids ?? []) {
      if (!instructionIds.has(id)) errors.push(`${claim.id} claims ${id}, which is not an instruction sentence`);
      if (claimed.has(id)) errors.push(`${id} is claimed by both ${claimed.get(id)} and ${claim.id}`);
      claimed.set(id, claim.id);
    }
    const frame = frames.frames?.[claim.frame];
    if (!frame) errors.push(`${claim.id} names frame ${claim.frame}, which is not in the manifest`);
    else {
      const spoken = spokenBy.get(claim.frame) ?? new Set();
      for (const id of claim.sentence_ids ?? []) {
        if (!spoken.has(id)) errors.push(`${claim.id}: ${id} is not spoken by a beat that uses ${claim.frame}`);
      }
      if (claim.status === "text" && frame.kind !== "text") errors.push(`${claim.id} is status text but ${claim.frame} is a ${frame.kind} frame`);
    }
    if (claim.status === "placeholder" && !claim.open_question) errors.push(`${claim.id} is a placeholder without an open question`);
    if (claim.status === "verified" && !claim.receipt) errors.push(`${claim.id} is verified without a receipt`);
    else if (claim.status === "verified" && root) {
      try {
        const doc = JSON.parse(await readFile(join(root, claim.receipt), "utf8"));
        if (doc.adjudication?.verdict !== "pass") errors.push(`${claim.id}: receipt ${claim.receipt} does not record a pass`);
        if (!doc.observers?.every((observer) => /\b5\./.test(observer.observation ?? ""))) errors.push(`${claim.id}: receipt ${claim.receipt} lacks the observers' instruction answers`);
      } catch {
        errors.push(`${claim.id}: receipt ${claim.receipt} is missing`);
      }
    }
    if (claim.rule_question && !questions.get(claim.rule_question)) errors.push(`${claim.id} rests on a rule whose question ${claim.rule_question} is not on the clinician's list`);
    if (claim.open_question) {
      const question = questions.get(claim.open_question);
      if (!question) errors.push(`${claim.id} points at ${claim.open_question}, which is not on the clinician's list`);
      else if (question.status === "answered" && claim.status === "placeholder") errors.push(`${claim.id} is still a placeholder but ${claim.open_question} is answered`);
    }
  }
  for (const id of instructionIds) {
    if (!claimed.has(id)) errors.push(`${id} is an instruction with no claim`);
  }
  const summary = Object.fromEntries(INSTRUCTION_STATUSES.map((status) => [status, (instructions.claims ?? []).filter((claim) => claim.status === status).length]));
  return { valid: errors.length === 0, errors, warnings, summary };
}
