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

test("the page label keys are required in every pack", () => {
  for (const key of ["ui.seek", "ui.coming", "ui.language_fallback", "ui.not_reviewed", "ui.replay", "ui.transcript", "ui.review_status"]) {
    assert.ok(requiredLabelKeys(bundle.segments).includes(key), key);
    assert.ok(englishPack.labels[key]?.trim(), key);
  }
});
