// scripts/lib/evaluator.mjs
// The API-backed image evaluator.
//
// Three caption-blind observers each receive the image inside the request, so none can answer
// without it, and nothing else: no caption, no claim, no contract. Their answers are split into short
// numbered units. A coder receives only the contract and those units and supports each finding by
// citing a unit, never by copying text: a coder asked to copy model outputs word for word was refused
// under the terms against duplicating model outputs. Code checks every citation, resolves anything it
// cannot verify in the direction that keeps a bad picture from passing, and computes the verdict with
// scripts/lib/adjudication.mjs. No model decides pass or fail. Spend is reserved in the ledger before
// the first call and settled from reported usage.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { adjudicate } from "./adjudication.mjs";
import { CLAUDE_PRICING, claudeUsd, estimateClaudeUsd, reserveSpend, settleSpend } from "./spend-ledger.mjs";

export const EVALUATOR_VERSION = "1.0";
export const DEFAULT_MODEL = "claude-opus-5";
export const API_BASE_URL = "https://api.anthropic.com";
// Server-side refusal fallbacks: a declined request is re-run on Anthropic's recommended substitute
// inside the same call. The receipt records which model actually answered.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const OBSERVER_MAX_TOKENS = 8000;
// Every review is coded more than once, and a picture passes only when every coding passes it.
// Identical inputs have produced different codings on borderline items, and a verdict that can
// change between identical runs must not pass a picture on the lucky run.
export const DEFAULT_CODINGS = 2;
export const CODER_MAX_TOKENS = 16000;
const OBSERVER_PROMPT_TOKENS = 1000;
const CODER_INPUT_TOKENS = 6000;
const LONG_EDGE_LIMIT = 2576;
const RECOVERY_ANSWERS = Object.freeze([1, 2, 3, 5]);
const READING_ANSWERS = Object.freeze([2, 3, 5]);

export const QUESTIONS = Object.freeze({
  view: "What part of the body is shown, and from where?",
  state: "What physical state or object do you see? If the image has several parts, describe each part in turn. Name anything worn, applied, or wrong with the skin, and say exactly where each thing sits.",
  marks: "Is there any text, number, arrow, label, or symbol in the image? For each one, say where it is and what it seems to indicate. If there is none, say so.",
  mistaken_for: "What could this picture be mistaken for? Name one alternative reading a worried patient might have.",
  instruction: "What is the picture telling the viewer to do, with what, and where? If an action has a direction, say which way it goes. If you cannot tell, say so."
});
const FIELDS = Object.freeze([["view", 1], ["state", 2], ["marks", 3], ["mistaken_for", 4], ["instruction", 5]]);

export class ReviewCallError extends Error {
  constructor(message, meta) {
    super(message);
    this.name = "ReviewCallError";
    this.meta = meta;
  }
}

export function extractPrompt(markdown, name) {
  const match = markdown.match(/<!-- prompt:start -->\n([\s\S]*?)\n<!-- prompt:end -->/);
  if (!match) throw new Error(`${name} has no prompt between <!-- prompt:start --> and <!-- prompt:end -->`);
  return match[1].trim();
}

export async function loadPrompts(root) {
  const read = async (name) => extractPrompt(await readFile(join(root, "reviewers/anatomy", name), "utf8"), name);
  return { observer: await read("observer.md"), coder: await read("coder.md") };
}

// A review contract: what each of three observers must recover, what none may read into the picture,
// which marks belong to it by design, which rule judges it, and whether it is an instruction picture.
export function reviewContract(source, { kind }) {
  if (!["asset", "diagram"].includes(kind)) throw new Error(`unknown contract kind ${kind}`);
  const required = source.observers_must_recover ?? [];
  if (required.length < 2) throw new Error(`${source.id}: observers_must_recover needs at least two items`);
  return {
    id: source.id,
    kind,
    rule: kind === "diagram" ? "instruction-picture" : "strict",
    instruction: kind === "diagram" || Boolean(source.instruction),
    required: [...required],
    forbidden: [...(source.claim?.forbidden ?? [])],
    allowed_marks: [...(source.claim?.allowed_marks ?? [])]
  };
}

const fieldsFor = (instruction) => FIELDS.filter(([key]) => instruction || key !== "instruction");

export function observerQuestions({ instruction }) {
  const lead = instruction ? "This picture is meant to show the viewer what to do. Answer each question from the picture alone." : "Answer each question from the picture alone.";
  return [lead, "", ...fieldsFor(instruction).map(([key, number]) => `${number}. ${QUESTIONS[key]}`)].join("\n");
}

export function observerSchema({ instruction }) {
  const properties = Object.fromEntries(fieldsFor(instruction).map(([key, number]) => [key, { type: "string", description: `Answer ${number}: ${QUESTIONS[key]}` }]));
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

export function observerRequest({ image, instruction, model = DEFAULT_MODEL, system }) {
  return {
    model,
    max_tokens: OBSERVER_MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: observerQuestions({ instruction }) }
        ]
      }
    ],
    output_config: { format: { type: "json_schema", schema: observerSchema({ instruction }) } }
  };
}

export function answersFromOutput(output, instruction) {
  const answers = {};
  for (const [key, number] of fieldsFor(instruction)) {
    if (typeof output?.[key] !== "string" || !output[key].trim()) throw new Error(`the observer left answer ${number} (${key}) empty`);
    answers[number] = output[key].trim();
  }
  return answers;
}

export function formatObservation(answers) {
  return Object.keys(answers).map(Number).sort((a, b) => a - b).map((number) => `${number}. ${answers[number]}`).join("\n\n");
}

// Reads numbered answers back out of a stored observation, including the in-session receipts, whose
// observers wrote free text ending with a label line.
export function parseObservation(text) {
  const cleaned = String(text ?? "").split("\n").filter((line) => !/^\s*(Label:|Caption-blind observer \(Claude\))/i.test(line)).join("\n");
  const starts = [...cleaned.matchAll(/(?:^|\n)\s*([1-5])\.\s/g)];
  const answers = {};
  starts.forEach((match, index) => {
    const number = Number(match[1]);
    const end = index + 1 < starts.length ? starts[index + 1].index : cleaned.length;
    if (!(number in answers)) answers[number] = cleaned.slice(match.index + match[0].length, end).trim();
  });
  return answers;
}

// Short citable units: bullet lines, then sentences and semicolon clauses.
export function splitUnits(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*]\s+/, "").trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/(?<=[.!?;])\s+(?=\S)/))
    .map((unit) => unit.trim())
    .filter(Boolean);
}

// Every unit of every answer, keyed o<observer>.<answer>.<unit>.
export function citeMap(observations) {
  const map = new Map();
  for (const observation of observations) {
    for (const [answer, text] of Object.entries(observation.answers)) {
      splitUnits(text).forEach((unit, index) => map.set(`o${observation.number}.${answer}.${index + 1}`, { observer: observation.number, answer: Number(answer), text: unit }));
    }
  }
  return map;
}

const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const enumOrString = (values) => (values.length ? { type: "string", enum: values } : { type: "string" });
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export function coderSchema(contract, citeIds = []) {
  const cite = { ...enumOrString(citeIds), description: "The id of the one unit, from this observer's answers, that states the finding." };
  const reading = object({ forbidden: enumOrString(contract.forbidden), cite });
  const observer = object({
    observer: { type: "integer", enum: [1, 2, 3] },
    items: {
      type: "array",
      description: "Every required item exactly once.",
      items: object({ item: enumOrString(contract.required), recovered: { type: "boolean" }, cite: nullable(cite) })
    },
    own_forbidden: { type: "array", items: reading },
    hedges: { type: "array", items: reading },
    unallowed_marks: { type: "array", items: object({ mark: { type: "string" }, cite }) },
    alternatives: { type: "array", items: object({ key: { type: "string" }, cite }) }
  });
  return object({
    observers: { type: "array", description: "Observers 1, 2, and 3, once each.", items: observer },
    alternatives: {
      type: "array",
      description: "Every distinct misreading named in answer 4 by any observer, once each.",
      items: object({ key: { type: "string" }, reading: { type: "string" }, forbidden: nullable(enumOrString(contract.forbidden)), harm: { type: "boolean" } })
    },
    design_notes: { type: "array", items: { type: "string" } }
  });
}

export function coderInput({ contract, observations }) {
  const list = (items) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- none");
  return [
    `Picture kind: ${contract.instruction ? "an instruction picture: it should tell the viewer what to do" : "a state picture: it should show a body part in a particular state"}`,
    "",
    "Required items. Each observer must state every one:",
    list(contract.required),
    "",
    "Forbidden readings:",
    list(contract.forbidden),
    "",
    "Marks that belong to the picture by design. Any other text, number, arrow, label, or symbol is unallowed:",
    list(contract.allowed_marks),
    "",
    "Each observer's answers, split into units labeled o<observer>.<answer>.<unit>:",
    "",
    ...observations.flatMap((observation) => {
      const units = [...citeMap([observation]).entries()];
      return [`Observer ${observation.number}:`, ...units.map(([id, unit]) => `[${id}] ${unit.text}`), ""];
    })
  ].join("\n").trim();
}

export function coderRequest({ contract, observations, model = DEFAULT_MODEL, system }) {
  return {
    model,
    max_tokens: CODER_MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: coderInput({ contract, observations }) }],
    output_config: { format: { type: "json_schema", schema: coderSchema(contract, [...citeMap(observations).keys()]) } }
  };
}

// A structural check of a parsed output against its schema. The API enforces the schema on success;
// this also catches a partial or reshaped answer and anything a test client returns.
export function matchesSchema(value, schema, path = "$") {
  if (schema.anyOf) return schema.anyOf.some((variant) => matchesSchema(value, variant, path).length === 0) ? [] : [`${path} matches none of its allowed shapes`];
  if (!schema.type) return [];
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  const typeMatches = schema.type === actual || (schema.type === "number" && actual === "integer");
  if (!typeMatches) return [`${path} should be ${schema.type}, not ${actual}`];
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} is not one of its allowed values`);
  if (schema.type === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key} is missing`);
    for (const [key, child] of Object.entries(value)) {
      if (!schema.properties?.[key]) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
        continue;
      }
      errors.push(...matchesSchema(child, schema.properties[key], `${path}.${key}`));
    }
  }
  if (schema.type === "array") value.forEach((item, index) => errors.push(...matchesSchema(item, schema.items ?? {}, `${path}[${index}]`)));
  return errors;
}

// Turns the coder's findings into the adjudicator's input, keeping only what the observers' answers
// support. A recovery counts only when it cites a unit of that observer's answer that can recover an
// item. A forbidden reading, hedge, mark, or misreading whose citation does not check out is kept, so
// an unverifiable finding can make a picture fail but never make it pass.
export function checkCoding({ contract, coding, observations }) {
  const units = citeMap(observations);
  const citationChecks = [];
  const tally = Object.fromEntries(contract.required.map((item) => [item, []]));
  const shared = new Map((coding.alternatives ?? []).map((alternative) => [alternative.key, alternative]));
  const findings = observations.map((observation, index) => {
    const number = index + 1;
    const entries = (coding.observers ?? []).filter((entry) => entry.observer === number);
    if (entries.length !== 1) citationChecks.push({ observer: number, finding: "observer", status: entries.length ? "coded more than once" : "not coded", effect: entries.length ? "the first coding is used" : "nothing recovered" });
    const entry = entries[0] ?? {};
    const check = (cite, allowed) => {
      const unit = units.get(cite);
      if (!unit) return { ok: false, status: `cites ${cite}, which does not exist` };
      if (unit.observer !== number) return { ok: false, status: `cites ${cite}, which is another observer's answer`, unit };
      if (!allowed.includes(unit.answer)) return { ok: false, status: `cites answer ${unit.answer}, which cannot support this finding`, unit };
      return { ok: true, unit };
    };
    const recovered = [];
    for (const item of contract.required) {
      const rows = (entry.items ?? []).filter((row) => row.item === item);
      if (!rows.length) {
        citationChecks.push({ observer: number, finding: item, status: "not coded", effect: "not recovered" });
        continue;
      }
      if (rows.some((row) => !row.recovered)) continue;
      const [row] = rows;
      const result = check(row.cite, RECOVERY_ANSWERS);
      if (!result.ok) {
        citationChecks.push({ observer: number, finding: item, cite: row.cite, text: result.unit?.text ?? null, status: result.status, effect: "not recovered" });
        continue;
      }
      recovered.push(item);
      tally[item].push({ observer: number, answer: result.unit.answer, cite: row.cite, text: result.unit.text });
    }
    const keep = (rows, kind, allowed, label) =>
      rows.map((row) => {
        const result = check(row.cite, allowed);
        if (!result.ok) citationChecks.push({ observer: number, finding: `${kind}: ${label(row)}`, cite: row.cite, text: result.unit?.text ?? null, status: result.status, effect: "kept, so it can only make the picture fail" });
        return row;
      });
    const alternatives = keep(entry.alternatives ?? [], "misreading", [4], (row) => row.key).map((row) => {
      const found = shared.get(row.key);
      if (!found) throw new Error(`the coder cites misreading "${row.key}" for observer ${number} but never defines it`);
      return { key: found.key, reading: found.reading, forbidden: found.forbidden ?? null, harm: Boolean(found.harm) };
    });
    return {
      recovered,
      own_forbidden: keep(entry.own_forbidden ?? [], "forbidden reading", READING_ANSWERS, (row) => row.forbidden).map((row) => row.forbidden),
      hedges: keep(entry.hedges ?? [], "hedge", READING_ANSWERS, (row) => row.forbidden).map((row) => row.forbidden),
      unallowed_marks: keep(entry.unallowed_marks ?? [], "unallowed mark", [3], (row) => row.mark).map((row) => row.mark),
      alternatives
    };
  });
  return { findings, tally, citation_checks: citationChecks };
}

export function imageTokens({ width, height }) {
  const scale = Math.min(1, LONG_EDGE_LIMIT / Math.max(width, height));
  return Math.ceil((width * scale * height * scale) / 750);
}

// The most a review can cost: every call at its output ceiling. Reserved before the first call.
export function reviewCostBound({ image, model = DEFAULT_MODEL, observe = true, codings = DEFAULT_CODINGS }) {
  const calls = [];
  if (observe) for (let index = 0; index < 3; index += 1) calls.push({ model, inputTokens: imageTokens(image) + OBSERVER_PROMPT_TOKENS, outputTokens: OBSERVER_MAX_TOKENS });
  for (let index = 0; index < codings; index += 1) calls.push({ model, inputTokens: CODER_INPUT_TOKENS, outputTokens: CODER_MAX_TOKENS });
  return estimateClaudeUsd(calls);
}

const unique = (values, key = (value) => value) => {
  const seen = new Set();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

// Combines the verdicts of several codings of the same observations. Each coding's findings are kept;
// the combined findings are their union, so the combined verdict passes only when every coding passes.
export function combineCodings({ contract, runs }) {
  const hitKey = (hit) => `${hit.observer}|${hit.source}|${hit.reading}`;
  const tag = (hits, index) => hits.map((hit) => ({ ...hit, coding: index + 1 }));
  const missed = contract.required.filter((item) => runs.some((run) => run.result.missed.includes(item)));
  const forbiddenHits = unique(runs.flatMap((run, index) => tag(run.result.forbidden_hits, index)), hitKey);
  const forbiddenHitsStrict = unique(runs.flatMap((run, index) => tag(run.result.forbidden_hits_strict, index)), hitKey);
  const verdicts = runs.map((run) => run.result.verdict);
  return {
    rule: contract.rule,
    verdict: missed.length === 0 && forbiddenHits.length === 0 ? "pass" : "fail",
    verdict_strict: missed.length === 0 && forbiddenHitsStrict.length === 0 ? "pass" : "fail",
    unsettled: verdicts.some((verdict) => verdict !== verdicts[0]),
    verdicts,
    missed,
    forbidden_hits: forbiddenHits,
    forbidden_hits_strict: forbiddenHitsStrict,
    design_notes: unique(runs.flatMap((run) => [...run.result.design_notes, ...(run.coding.design_notes ?? [])]))
  };
}

const mostExpensive = () => Object.entries(CLAUDE_PRICING.perMillionUsd).sort(([, a], [, b]) => b.output - a.output)[0][0];
const callUsd = (call) => {
  const model = CLAUDE_PRICING.perMillionUsd[call.served_model] ? call.served_model : mostExpensive();
  return claudeUsd({ model, inputTokens: call.usage.input_tokens, outputTokens: call.usage.output_tokens, cacheWriteTokens: call.usage.cache_creation_input_tokens, cacheReadTokens: call.usage.cache_read_input_tokens });
};
export const callsUsd = (calls) => Number(calls.reduce((sum, call) => sum + callUsd(call), 0).toFixed(6));

export async function callStructured(client, params) {
  const response = await client.beta.messages.create(params);
  const usage = response.usage ?? {};
  const meta = {
    message_id: response.id ?? null,
    request_id: response._request_id ?? null,
    requested_model: params.model,
    served_model: response.model ?? params.model,
    fell_back: (usage.iterations ?? []).some((entry) => entry.type === "fallback_message"),
    stop_reason: response.stop_reason ?? null,
    usage: {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0
    }
  };
  if (response.stop_reason === "refusal") throw new ReviewCallError(`${params.model} declined (${response.stop_details?.category ?? "no category given"}), and so did every fallback`, meta);
  if (response.stop_reason === "max_tokens") throw new ReviewCallError(`the answer hit max_tokens (${params.max_tokens}) before it was complete`, meta);
  const text = (response.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("");
  let output;
  try {
    output = JSON.parse(text);
  } catch {
    throw new ReviewCallError("the structured output did not parse as JSON", meta);
  }
  const problems = matchesSchema(output, params.output_config.format.schema);
  if (problems.length) throw new ReviewCallError(`the structured output does not match its schema: ${problems.slice(0, 3).join("; ")}`, meta);
  return { output, meta };
}

function describe(result, contract) {
  const parts = [];
  if (result.unsettled) parts.push(`The codings disagreed (${result.verdicts.join(", ")}), and a picture passes only when every coding passes, so a clinician should look at it.`);
  parts.push(result.missed.length ? `Not recovered by all three observers: ${result.missed.join("; ")}.` : `All three observers recovered all ${contract.required.length} required items.`);
  if (result.forbidden_hits.length) {
    parts.push(`Forbidden: ${result.forbidden_hits.map((hit) => `observer ${hit.observer} (${hit.source}): ${hit.reading}`).join("; ")}.`);
  } else {
    parts.push(contract.rule === "strict" ? "No observer states a forbidden reading, and no unallowed mark was reported." : "No observer's own answer states a forbidden reading, no unallowed mark was reported, and no harmful misreading is shared by two observers.");
  }
  if (contract.rule !== "strict") parts.push(`Under the strict rule the picture would ${result.verdict_strict}.`);
  return parts.join(" ");
}

export function buildReceipt({ target, contract, observations, runs, result, calls, model, reviewedOn }) {
  const recoded = Boolean(target.recoded_from);
  const [first] = runs;
  const recovered = contract.required.filter((item) => !result.missed.includes(item));
  return {
    schema_version: "1.1",
    record_id: target.record_id ?? target.id,
    contract_id: contract.id,
    kind: target.kind,
    file: target.file ?? null,
    sha256: target.sha256 ?? null,
    reviewed_on: reviewedOn,
    method: recoded
      ? `API evaluator ${EVALUATOR_VERSION}, re-coding only: the observers' stored words from ${target.recoded_from} were coded ${runs.length} times by a coder that saw only the contract and those words; the verdict is computed in code and passes only when every coding passes (scripts/lib/adjudication.mjs). AI review is not clinical approval.`
      : `API evaluator ${EVALUATOR_VERSION}: three caption-blind observers each received only the image inside the request; a coder, run ${runs.length} times, received only the contract and their answers split into numbered units and cited a unit for each finding; code verified every citation and computed the verdict, which passes only when every coding passes (scripts/lib/adjudication.mjs). AI review is not clinical approval.`,
    evaluator: {
      version: EVALUATOR_VERSION,
      library: "scripts/lib/evaluator.mjs",
      rule: contract.rule,
      requested_model: model,
      calls: calls.map(({ role, message_id, request_id, requested_model, served_model, fell_back, stop_reason, usage }) => ({ role, message_id, request_id, requested_model, served_model, fell_back, stop_reason, usage })),
      cost_usd: callsUsd(calls)
    },
    inspection: null,
    observers: observations.map((observation) => ({
      label: `Caption-blind observer ${observation.number} (Claude)`,
      model: observation.meta?.served_model ?? null,
      message_id: observation.meta?.message_id ?? null,
      recoded_from: target.recoded_from ?? null,
      answers: observation.answers,
      observation: formatObservation(observation.answers)
    })),
    adjudication: {
      label: "Findings coded by Claude from the observers' answers, each citing the unit that states it and checked in code; verdict computed in code. Not a clinician.",
      rule: result.rule,
      verdict: result.verdict,
      verdict_strict: result.verdict_strict,
      unsettled: result.unsettled,
      tally: first.check.tally,
      recovered,
      missed: result.missed,
      forbidden_hits: result.forbidden_hits,
      forbidden_hits_strict: result.forbidden_hits_strict,
      design_notes: result.design_notes,
      citation_checks: runs.flatMap((run, index) => run.check.citation_checks.map((entry) => ({ coding: index + 1, ...entry }))),
      codings: runs.map((run, index) => ({
        coding: index + 1,
        verdict: run.result.verdict,
        verdict_strict: run.result.verdict_strict,
        missed: run.result.missed,
        forbidden_hits: run.result.forbidden_hits,
        tally: run.check.tally,
        findings: run.coding
      })),
      reason: describe(result, contract)
    },
    panels: target.panels ?? null,
    clinician_review: { status: "pending", reviewer: null, date: null, note: "Song reviews the picture against its claim; this receipt is evidence for that review, not a substitute for it." }
  };
}

// One review. With stored observations it re-codes them instead of observing again.
export async function runReview({ client, contract, image, target, prompts, ledger, persistLedger, model = DEFAULT_MODEL, observations: stored = null, codings = DEFAULT_CODINGS, reviewedOn = new Date().toISOString().slice(0, 10), now = () => new Date().toISOString() }) {
  if (!(Number.isInteger(codings) && codings >= 1)) throw new Error("codings must be a whole number of at least 1");
  const observe = !stored;
  const ledgerId = `review:${target.id}:${now()}`;
  let current = reserveSpend(ledger, {
    id: ledgerId,
    model,
    purpose: observe ? `caption-blind review of ${target.id}: three observers and ${codings} codings` : `${codings} codings of the stored observations of ${target.recoded_from}`,
    units: { image: target.file ?? null, calls: (observe ? 3 : 0) + codings },
    estimate_usd: reviewCostBound({ image, model, observe, codings })
  });
  await persistLedger(current);
  const calls = [];
  const settle = async (status) => {
    current = settleSpend(current, ledgerId, { status, requestId: calls.map((call) => call.message_id).filter(Boolean).join(",") || null, actualUsd: callsUsd(calls) });
    await persistLedger(current);
  };
  try {
    let observations = stored;
    if (observe) {
      const params = observerRequest({ image, instruction: contract.instruction, model, system: prompts.observer });
      const settled = await Promise.allSettled([0, 1, 2].map(() => callStructured(client, params)));
      for (const outcome of settled) {
        const meta = outcome.status === "fulfilled" ? outcome.value.meta : outcome.reason?.meta;
        if (meta) calls.push({ role: "observer", ...meta });
      }
      const failure = settled.find((outcome) => outcome.status === "rejected");
      if (failure) throw failure.reason;
      observations = settled.map((outcome, index) => ({ number: index + 1, answers: answersFromOutput(outcome.value.output, contract.instruction), meta: outcome.value.meta }));
    }
    const params = coderRequest({ contract, observations, model, system: prompts.coder });
    const coded = await Promise.allSettled(Array.from({ length: codings }, () => callStructured(client, params)));
    for (const outcome of coded) {
      const meta = outcome.status === "fulfilled" ? outcome.value.meta : outcome.reason?.meta;
      if (meta) calls.push({ role: "coder", ...meta });
    }
    const codingFailure = coded.find((outcome) => outcome.status === "rejected");
    if (codingFailure) throw codingFailure.reason;
    const runs = coded.map((outcome) => {
      const check = checkCoding({ contract, coding: outcome.value.output, observations });
      return { coding: outcome.value.output, check, result: adjudicate({ required: contract.required, observers: check.findings, rule: contract.rule }) };
    });
    const result = combineCodings({ contract, runs });
    const receipt = buildReceipt({ target, contract, observations, runs, result, calls, model, reviewedOn });
    await settle("completed");
    return { receipt, ledger: current, cost: callsUsd(calls) };
  } catch (error) {
    await settle("failed");
    throw error;
  }
}
