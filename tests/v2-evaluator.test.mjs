import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { receiptVerdictErrors } from "../scripts/lib/adjudication.mjs";
import { validateAnatomy } from "../scripts/lib/anatomy.mjs";
import { runCalibration } from "../scripts/lib/calibration.mjs";
import {
  API_BASE_URL,
  DEFAULT_MODEL,
  FALLBACK_BETA,
  checkCoding,
  citeMap,
  coderRequest,
  formatObservation,
  imageTokens,
  loadPrompts,
  matchesSchema,
  observerRequest,
  parseObservation,
  reviewContract,
  reviewCostBound,
  runReview,
  splitUnits
} from "../scripts/lib/evaluator.mjs";
import { createClient, resolveSelection, reviewAndRecord } from "../scripts/lib/review-runner.mjs";
import { ledgerTotals } from "../scripts/lib/spend-ledger.mjs";

const root = resolve(import.meta.dirname, "..");
const contracts = JSON.parse(await readFile(resolve(root, "content/anatomy/contracts.json"), "utf8"));
const prompts = await loadPrompts(root);
const card = contracts.diagrams.find((diagram) => diagram.id === "diagram.remove-dressing");
const cardContract = reviewContract(card, { kind: "diagram" });
const cardReceipt = JSON.parse(await readFile(resolve(root, "content/reviews/anatomy/diagram.remove-dressing.json"), "utf8"));
const cardAnswers = cardReceipt.observers.map((observer) => parseObservation(observer.observation));
const image = { file: "assets/anatomy/diagrams/remove-dressing.png", mediaType: "image/png", base64: "iVBORw0KGgo=", width: 1024, height: 768, bytes: 8, sha256: "0".repeat(64) };
const target = { id: "diagram.remove-dressing", kind: "diagram", file: image.file, sha256: image.sha256 };
const [dressingOn, handAway, bareHead, comesOff, lookForTape] = cardContract.required;
const cardObservations = cardAnswers.map((answers, index) => ({ number: index + 1, answers }));
const unitsOf = (observations) => citeMap(observations);
const citeIn = (units) => (observer, phrase) => {
  for (const [id, unit] of units) if (unit.observer === observer && unit.text.includes(phrase)) return id;
  throw new Error(`fixture: observer ${observer} never says "${phrase}"`);
};
const cite = citeIn(unitsOf(cardObservations));

// The static card's in-session observations, coded by hand the way the coder is asked to.
const cardCoding = () => ({
  observers: [
    {
      observer: 1,
      items: [
        { item: dressingOn, recovered: true, cite: cite(1, "white rounded pad over the ear") },
        { item: handAway, recovered: true, cite: cite(1, "a hand pulls the band's loose tail backward") },
        { item: bareHead, recovered: true, cite: cite(1, "Panel 3: no band or pad") },
        { item: comesOff, recovered: true, cite: cite(1, "band and pad come off") },
        { item: lookForTape, recovered: true, cite: cite(1, "Then look behind the ear for a tan strip") }
      ],
      own_forbidden: [],
      hedges: [],
      unallowed_marks: [],
      alternatives: [
        { key: "reverse-action", cite: cite(1, "it shows a head being wrapped") },
        { key: "strip-as-wound", cite: cite(1, "The tan strip could pass for a wound") }
      ]
    },
    {
      observer: 2,
      items: [
        { item: dressingOn, recovered: true, cite: cite(2, "with a white rounded pad over the ear") },
        { item: handAway, recovered: true, cite: cite(2, "Untie the white band behind the head and pull it away") },
        { item: bareHead, recovered: true, cite: cite(2, "Panel 3: bare head") },
        { item: comesOff, recovered: true, cite: cite(2, "The band and ear pad are coming off") },
        { item: lookForTape, recovered: true, cite: cite(2, "Then look behind the ear for a beige strip") }
      ],
      own_forbidden: [],
      hedges: [],
      unallowed_marks: [],
      alternatives: [
        { key: "apply-tape", cite: cite(2, 'could read as "put tape on here') },
        { key: "no-strip-wrong", cite: cite(2, "no strip means something is wrong") }
      ]
    },
    {
      observer: 3,
      items: [
        { item: dressingOn, recovered: true, cite: cite(3, "A white rounded pad covers the ear") },
        { item: handAway, recovered: true, cite: cite(3, "a hand pulls the band's tails behind the head") },
        { item: bareHead, recovered: true, cite: cite(3, "Panel 3: nothing is worn") },
        { item: comesOff, recovered: true, cite: cite(3, "It is coming off, going by number order") },
        { item: lookForTape, recovered: true, cite: cite(3, "Then check behind the ear for a beige strip") }
      ],
      own_forbidden: [],
      hedges: [{ forbidden: "the dressing being put on", cite: cite(3, "the arrow alone could mean tightening") }],
      unallowed_marks: [],
      alternatives: [{ key: "apply-tape", cite: cite(3, "It could be read as an order to stick tape behind the ear") }]
    }
  ],
  alternatives: [
    { key: "reverse-action", reading: "a head being wrapped rather than unwrapped", forbidden: "the dressing being put on", harm: false },
    { key: "strip-as-wound", reading: "the strip could pass for a wound", forbidden: "the ear injured or bleeding", harm: true },
    { key: "apply-tape", reading: "an order to put tape on behind the ear", forbidden: null, harm: false },
    { key: "no-strip-wrong", reading: "no strip means something is wrong", forbidden: null, harm: false }
  ],
  design_notes: ["Observers 2 and 3 note that the pad's removal is not drawn."]
});

const toOutput = (answers) => ({ view: answers[1], state: answers[2], marks: answers[3], mistaken_for: answers[4], instruction: answers[5] });
let messageCounter = 0;
function reply(output, { model = DEFAULT_MODEL, input = 1500, outputTokens = 900, stop = "end_turn", fallback = false } = {}) {
  messageCounter += 1;
  return {
    id: `msg_test_${messageCounter}`,
    type: "message",
    role: "assistant",
    model,
    stop_reason: stop,
    stop_details: stop === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
    content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }],
    usage: { input_tokens: input, output_tokens: outputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, iterations: fallback ? [{ type: "fallback_message" }] : null }
  };
}
const isObserverCall = (params) => Array.isArray(params.messages[0].content) && params.messages[0].content.some((block) => block.type === "image");
function fakeClient({ observers = cardAnswers.map(toOutput), coding = cardCoding(), coderOptions = {}, observerOptions = [] } = {}) {
  const calls = [];
  let observed = 0;
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          if (isObserverCall(params)) {
            const index = observed % observers.length;
            observed += 1;
            return reply(observers[index], observerOptions[index] ?? {});
          }
          return reply(coding, { input: 3000, outputTokens: 2500, ...coderOptions });
        }
      }
    }
  };
}
const freshLedger = (committed = 0) => ({ schema_version: "1.0", cap_usd: 10, entries: committed ? [{ id: "prior", model: "x", purpose: "x", units: {}, estimate_usd: committed, actual_usd: committed, request_id: null, status: "completed" }] : [] });
const review = async (overrides = {}) => {
  const saved = [];
  const client = overrides.client ?? fakeClient();
  const outcome = runReview({ client, contract: cardContract, image, target, prompts, ledger: overrides.ledger ?? freshLedger(), persistLedger: async (ledger) => saved.push(ledger), reviewedOn: "2026-09-18", ...overrides.options });
  return { outcome, saved, client };
};
const strings = (contract, source) => [...contract.required, ...contract.forbidden, ...contract.allowed_marks, source.claim?.state, source.claim?.anatomy].filter((value) => typeof value === "string" && value.length > 12);

test("observers are caption-blind: the request carries the image and the questions, and nothing from the contract", () => {
  const sources = [...contracts.assets.map((asset) => [asset, reviewContract(asset, { kind: "asset" })]), ...contracts.diagrams.map((diagram) => [diagram, reviewContract(diagram, { kind: "diagram" })])];
  for (const [source, contract] of sources) {
    const params = observerRequest({ image, instruction: contract.instruction, model: DEFAULT_MODEL, system: prompts.observer });
    const images = params.messages[0].content.filter((block) => block.type === "image");
    assert.equal(images.length, 1, source.id);
    assert.equal(images[0].source.type, "base64");
    const text = JSON.stringify({ ...params, messages: [{ ...params.messages[0], content: params.messages[0].content.filter((block) => block.type !== "image") }] }).toLowerCase();
    for (const value of strings(contract, source)) assert.ok(!text.includes(value.toLowerCase()), `${source.id}: the observer request leaks "${value}"`);
    assert.ok(!text.includes(source.id.toLowerCase()), `${source.id}: the observer request names the asset`);
    assert.deepEqual(params.betas, [FALLBACK_BETA]);
    assert.equal(params.fallbacks, "default");
    assert.equal(params.output_config.format.type, "json_schema");
    assert.equal("instruction" in params.output_config.format.schema.properties, contract.instruction, source.id);
  }
});

test("the coder sees the observers' words and the contract but never the image, and its schema is built from the contract", () => {
  const observations = cardAnswers.map((answers, index) => ({ number: index + 1, answers }));
  const params = coderRequest({ contract: cardContract, observations, model: DEFAULT_MODEL, system: prompts.coder });
  assert.ok(params.messages.every((message) => typeof message.content === "string" || message.content.every((block) => block.type !== "image")));
  const text = JSON.stringify(params.messages);
  for (const answers of cardAnswers) assert.ok(text.includes(JSON.stringify(answers[4]).slice(1, 40)));
  for (const item of cardContract.required) assert.ok(text.includes(item));
  const observer = params.output_config.format.schema.properties.observers.items.properties;
  assert.deepEqual(observer.items.items.properties.item.enum, cardContract.required);
  assert.deepEqual(observer.own_forbidden.items.properties.forbidden.enum, cardContract.forbidden);
  assert.deepEqual(observer.alternatives.items.properties.cite.enum, [...citeMap(observations).keys()]);
  assert.ok(!/exact words|verbatim|copy/i.test(params.system + params.messages[0].content), "the coder is never asked to copy model outputs");
  assert.ok(!text.includes(card.claim.state), "the coder is not told what the picture is meant to show");
});

test("the static card's in-session observations, coded, pass the instruction-picture rule and fail the strict rule, as they did in session", async () => {
  const { outcome, saved, client } = await review();
  const { receipt, cost } = await outcome;
  assert.equal(client.calls.length, 5, "three observers and two codings");
  assert.equal(client.calls.filter(isObserverCall).length, 3);
  assert.equal(receipt.adjudication.unsettled, false);
  assert.equal(receipt.adjudication.codings.length, 2);
  assert.equal(receipt.adjudication.verdict, "pass");
  assert.equal(receipt.adjudication.verdict_strict, "fail");
  assert.deepEqual(receipt.adjudication.missed, []);
  assert.deepEqual(receiptVerdictErrors(receipt), []);
  assert.ok(receipt.observers.every((observer) => /\b5\. /.test(observer.observation)), "instruction answers stay in the receipt");
  assert.equal(receipt.adjudication.tally[comesOff].length, 3);
  assert.ok(receipt.adjudication.design_notes.some((note) => /pad's removal/.test(note)));
  assert.equal(cost, 0.245);
  const entry = saved.at(-1).entries.at(-1);
  assert.match(entry.id, /^review:diagram\.remove-dressing:/);
  assert.equal(entry.status, "completed");
  assert.equal(entry.actual_usd, 0.245);
  assert.ok(saved.length >= 2, "the reservation is saved before any call");
  assert.equal(saved[0].entries.at(-1).status, "reserved");
});

test("a finding counts only when it cites a unit of that observer's answer that can support it", () => {
  const coding = cardCoding();
  coding.observers[0].items[3].cite = cite(1, "it shows a head being wrapped");
  coding.observers[1].items[4].cite = cite(1, "Then look behind the ear for a tan strip");
  coding.observers[2].items[0].cite = "o3.9.9";
  const check = checkCoding({ contract: cardContract, coding, observations: cardObservations });
  assert.ok(!check.findings[0].recovered.includes(comesOff), "answer 4, the misreading, cannot recover an item");
  assert.ok(!check.findings[1].recovered.includes(lookForTape), "another observer's words cannot recover an item");
  assert.ok(!check.findings[2].recovered.includes(dressingOn), "an invented citation cannot recover an item");
  const statuses = check.citation_checks.map((entry) => entry.status).join("\n");
  assert.match(statuses, /cannot support this finding/);
  assert.match(statuses, /another observer's answer/);
  assert.match(statuses, /does not exist/);
  const undefinedKey = cardCoding();
  undefinedKey.observers[0].alternatives.push({ key: "invented", cite: cite(1, "it shows a head being wrapped") });
  assert.throws(() => checkCoding({ contract: cardContract, coding: undefinedKey, observations: cardObservations }), /never defines/);
  const missing = cardCoding();
  missing.observers.pop();
  assert.deepEqual(checkCoding({ contract: cardContract, coding: missing, observations: cardObservations }).findings[2].recovered, []);
  const tally = checkCoding({ contract: cardContract, coding: cardCoding(), observations: cardObservations }).tally;
  assert.equal(tally[comesOff][0].text, "band and pad come off, per the 1–3 order.", "the receipt shows the words each citation points to");
});

test("answers split into citable units at bullets, sentences, and semicolons, labeled by observer, answer, and unit", () => {
  assert.deepEqual(splitUnits("Panel 1: a band, bow at the back; a pad over the ear. Panel 2: bare.\n   - Numbers 1–4 at 101.5 °F. \"Tape?\" sits below."), [
    "Panel 1: a band, bow at the back;",
    "a pad over the ear.",
    "Panel 2: bare.",
    "Numbers 1–4 at 101.5 °F.",
    "\"Tape?\" sits below."
  ]);
  const units = citeMap([{ number: 2, answers: { 1: "Head. Neck.", 4: "A burn." } }]);
  assert.deepEqual([...units.keys()], ["o2.1.1", "o2.1.2", "o2.4.1"]);
  assert.deepEqual(units.get("o2.4.1"), { observer: 2, answer: 4, text: "A burn." });
});

test("stored observations parse back into their numbered answers for every receipt in the repository", async () => {
  const names = (await readdir(resolve(root, "content/reviews/anatomy"))).filter((name) => name.endsWith(".json"));
  assert.ok(names.length >= 14);
  for (const name of names) {
    const receipt = JSON.parse(await readFile(resolve(root, "content/reviews/anatomy", name), "utf8"));
    for (const observer of receipt.observers) {
      const answers = parseObservation(observer.observation);
      for (const number of [1, 2, 3, 4]) assert.ok(answers[number]?.length > 3, `${name}: answer ${number} is missing`);
      assert.ok(!/Caption-blind observer \(Claude\)/.test(answers[4] + (answers[5] ?? "")), `${name}: the label line leaked into an answer`);
      assert.equal(parseObservation(formatObservation(answers))[2], answers[2]);
    }
  }
});

test("a refusal, a truncated answer, or output that breaks the schema stops the review and still records what was billed", async () => {
  const refused = await review({ client: fakeClient({ coderOptions: { stop: "refusal" } }) });
  await assert.rejects(refused.outcome, /declined/);
  const refusedEntry = refused.saved.at(-1).entries.at(-1);
  assert.equal(refusedEntry.status, "failed");
  assert.ok(refusedEntry.actual_usd > 0.09, "the three observer calls were billed and are recorded");
  const truncated = await review({ client: fakeClient({ observerOptions: [{}, { stop: "max_tokens" }, {}] }) });
  await assert.rejects(truncated.outcome, /max_tokens/);
  assert.equal(truncated.client.calls.length, 3, "the coder never runs when an observer fails");
  const broken = await review({ client: fakeClient({ coding: { observers: [] } }) });
  await assert.rejects(broken.outcome, /does not match its schema/);
});

test("the spend cap stops a review before any call, and a served fallback model is recorded", async () => {
  const capped = await review({ ledger: freshLedger(9.5) });
  await assert.rejects(capped.outcome, /spend cap/);
  assert.equal(capped.client.calls.length, 0);
  assert.equal(capped.saved.length, 0);
  const fellBack = await review({ client: fakeClient({ observerOptions: [{ model: "claude-opus-4-8", fallback: true }] }) });
  const { receipt } = await fellBack.outcome;
  assert.equal(receipt.observers[0].model, "claude-opus-4-8");
  assert.equal(receipt.evaluator.calls[0].fell_back, true);
});

test("structured outputs are checked against their schema in code as well", () => {
  const schema = { type: "object", properties: { item: { type: "string", enum: ["a", "b"] }, answer: { anyOf: [{ type: "integer" }, { type: "null" }] } }, required: ["item", "answer"], additionalProperties: false };
  assert.deepEqual(matchesSchema({ item: "a", answer: null }, schema), []);
  assert.ok(matchesSchema({ item: "c", answer: 2 }, schema).length > 0);
  assert.ok(matchesSchema({ item: "a", answer: 2, extra: true }, schema).length > 0);
  assert.ok(matchesSchema({ item: "a" }, schema).length > 0);
});

test("the cost bound covers every call at its token ceiling and the image's token size", () => {
  assert.equal(imageTokens({ width: 1024, height: 768 }), 1049);
  assert.equal(imageTokens({ width: 4000, height: 3000 }), 6636);
  assert.equal(reviewCostBound({ image, model: DEFAULT_MODEL }), 1.5);
  assert.equal(reviewCostBound({ image, model: DEFAULT_MODEL, observe: false }), 0.86);
  assert.equal(reviewCostBound({ image, model: DEFAULT_MODEL, codings: 1 }), 1.07);
  assert.throws(() => reviewCostBound({ image, model: "claude-unknown-9" }), /no price/);
});

test("the client talks to the public API with the user's own key, not the desktop app's base URL", () => {
  assert.throws(() => createClient({}), /ANTHROPIC_API_KEY is missing/);
  const client = createClient({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: "http://127.0.0.1:1" });
  assert.equal(client.baseURL, API_BASE_URL);
  assert.equal(createClient({ ANTHROPIC_API_KEY: "sk-test", AVS_ANTHROPIC_BASE_URL: "https://gateway.example.com" }).baseURL, "https://gateway.example.com");
});

test("re-coding an in-session receipt sends only the codings, from the observers' stored words", async () => {
  const selection = await resolveSelection(root, { recode: "content/reviews/anatomy/diagram.remove-dressing.json" });
  assert.equal(selection.contract.id, "diagram.remove-dressing");
  assert.equal(selection.observations.length, 3);
  const client = fakeClient();
  const { receipt } = await runReview({ client, contract: selection.contract, image: null, target: selection.target, prompts, ledger: freshLedger(), persistLedger: async () => {}, observations: selection.observations, reviewedOn: "2026-09-18" });
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls.every((params) => !isObserverCall(params)));
  assert.equal(receipt.adjudication.verdict, "pass");
  assert.equal(receipt.observers[0].recoded_from, "content/reviews/anatomy/diagram.remove-dressing.json");
});

async function scratchRoot() {
  const dir = await mkdtemp(join(tmpdir(), "avs-evaluator-"));
  for (const path of ["reviewers", "content/anatomy", "content/spend", "content/reviews", "assets/anatomy"]) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await cp(join(root, path), join(dir, path), { recursive: true });
  }
  return dir;
}
async function snapshot(dir) {
  const files = await readdir(dir, { recursive: true });
  return Promise.all(files.sort().map(async (file) => `${file}:${(await stat(join(dir, file))).size}`));
}

test("recording a review writes the receipt, indexes it, updates the manifest, and accepts a passing candidate only with --apply", async () => {
  const dir = await scratchRoot();
  try {
    const answers = { view: "The back of a head, seen from behind and to the right.", state: "Red, raised swelling behind the ear along a thin healed scar; no open wound.", marks: "No text, arrows, or labels.", mistaken_for: "A sunburn." };
    const red = reviewContract(contracts.assets.find((asset) => asset.id === "postauricular-red-swollen"), { kind: "asset" });
    const redUnits = citeIn(unitsOf([1, 2, 3].map((number) => ({ number, answers: { 1: answers.view, 2: answers.state, 3: answers.marks, 4: answers.mistaken_for } }))));
    const phrases = ["Red, raised swelling behind the ear along a thin healed scar", "Red, raised swelling behind the ear", "no open wound"];
    const coding = {
      observers: [1, 2, 3].map((observer) => ({ observer, items: red.required.map((item, index) => ({ item, recovered: true, cite: redUnits(observer, phrases[index]) })), own_forbidden: [], hedges: [], unallowed_marks: [], alternatives: [{ key: "sunburn", cite: redUnits(observer, "A sunburn") }] })),
      alternatives: [{ key: "sunburn", reading: "a sunburn", forbidden: null, harm: false }],
      design_notes: []
    };
    const client = fakeClient({ observers: [answers, answers, answers], coding });
    await assert.rejects(reviewAndRecord({ root: dir, selection: { record: "postauricular-red-swollen-a3" }, client }), /already exists/);
    await assert.rejects(reviewAndRecord({ root: dir, selection: { record: "postauricular-base-a2", as: "postauricular-dressing-ref" }, client }), /--out/);
    const outcome = await reviewAndRecord({ root: dir, selection: { record: "postauricular-red-swollen-a3" }, client, force: true, apply: true });
    assert.equal(outcome.verdict, "pass");
    assert.equal(outcome.path, "content/reviews/anatomy/postauricular-red-swollen-a3.json");
    const manifest = JSON.parse(await readFile(join(dir, "assets/anatomy/manifest.json"), "utf8"));
    const record = manifest.records.find((item) => item.id === "postauricular-red-swollen-a3");
    assert.equal(record.status, "accepted");
    assert.equal(record.review.receipt, outcome.path);
    const index = JSON.parse(await readFile(join(dir, "content/reviews/index.json"), "utf8"));
    assert.ok(index.anatomy.includes(outcome.path));
    const ledger = JSON.parse(await readFile(join(dir, "content/spend/v2-ledger.json"), "utf8"));
    assert.equal(ledger.entries.at(-1).status, "completed");
    const anatomy = await validateAnatomy({ contracts, manifest, frames: { frames: {} }, root: dir });
    assert.deepEqual(anatomy.errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a dry run makes no call and changes no file", async () => {
  const dir = await scratchRoot();
  try {
    const before = await snapshot(dir);
    const client = fakeClient();
    const outcome = await reviewAndRecord({ root: dir, selection: { diagram: "diagram.remove-dressing" }, client, dryRun: true });
    assert.equal(outcome.dryRun, true);
    assert.equal(outcome.preview.calls, 5);
    assert.equal(outcome.preview.cost_bound_usd, 1.5);
    assert.ok(!JSON.stringify(outcome.preview).includes("iVBORw0KGgo"), "the preview never carries the image bytes");
    assert.equal(client.calls.length, 0);
    assert.deepEqual(await snapshot(dir), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("every calibration case resolves against the repository, and a dry run prices the whole set without spending", async () => {
  const before = ledgerTotals(JSON.parse(await readFile(resolve(root, "content/spend/v2-ledger.json"), "utf8")));
  const plan = await runCalibration({ root, dryRun: true });
  assert.ok(plan.rows.length >= 20);
  assert.ok(plan.rows.every((row) => !row.error), plan.rows.filter((row) => row.error).map((row) => `${row.id}: ${row.error}`).join("; "));
  assert.ok(plan.rows.some((row) => row.expect === "fail" && row.mode === "image"), "the set includes images that must fail");
  const cases = JSON.parse(await readFile(resolve(root, "content/reviews/calibration/cases.json"), "utf8"));
  assert.ok(cases.development_cases.every((path) => cases.recode_cases.includes(path)), "every development case is a listed re-coding");
  assert.ok(cases.recode_cases.length - cases.development_cases.length >= 7, "most re-codings stay held out");
  assert.ok(plan.bound_usd > 0);
  const after = ledgerTotals(JSON.parse(await readFile(resolve(root, "content/spend/v2-ledger.json"), "utf8")));
  assert.deepEqual(after, before);
});

test("calibration can repeat every case, and a case whose runs disagree counts as unsettled", async () => {
  const dir = await scratchRoot();
  try {
    await mkdir(join(dir, "content/reviews/calibration"), { recursive: true });
    const flip = (() => {
      let codings = 0;
      return {
        calls: [],
        beta: {
          messages: {
            create: async (params) => {
              codings += 1;
              const coding = cardCoding();
              if (codings % 2 === 0) coding.observers[0].items[3].cite = cite(1, "it shows a head being wrapped");
              return reply(coding, { input: 3000, outputTokens: 2500 });
            }
          }
        }
      };
    })();
    const report = await runCalibration({ root: dir, client: flip, only: "recode-diagram.remove-dressing", repeat: 2, codings: 1 });
    assert.equal(report.rows.length, 1);
    assert.deepEqual(report.rows[0].verdicts, ["pass", "fail"]);
    assert.equal(report.rows[0].got, "unsettled");
    assert.equal(report.rows[0].agree, false);
    assert.equal(report.agreement.unsettled, 1);
    assert.equal(report.rows[0].development, true);
    assert.equal(report.agreement.held_out.scored, 0);
    assert.ok(report.rows[0].receipts.every((path) => /\.r[12]\.json$/.test(path)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("when two codings of the same answers disagree, the picture fails, is marked unsettled, and the reason asks for a clinician", async () => {
  let codingCalls = 0;
  const client = {
    calls: [],
    beta: {
      messages: {
        create: async (params) => {
          client.calls.push(params);
          if (isObserverCall(params)) return reply(toOutput(cardAnswers[(client.calls.length - 1) % 3]));
          codingCalls += 1;
          const coding = cardCoding();
          if (codingCalls === 2) coding.observers[2].items[3].cite = cite(3, "It could be read as an order to stick tape behind the ear");
          return reply(coding, { input: 3000, outputTokens: 2500 });
        }
      }
    }
  };
  const { outcome } = await review({ client });
  const { receipt } = await outcome;
  assert.equal(receipt.adjudication.verdict, "fail");
  assert.equal(receipt.adjudication.unsettled, true);
  assert.deepEqual(receipt.adjudication.codings.map((coding) => coding.verdict), ["pass", "fail"]);
  assert.deepEqual(receipt.adjudication.missed, [comesOff]);
  assert.match(receipt.adjudication.reason, /codings disagreed .*clinician/);
  assert.deepEqual(receiptVerdictErrors(receipt), []);
});
