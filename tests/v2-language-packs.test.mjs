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
  sentences["call.02"] = "Llame si tiene fiebre de más de 101.5 grados Fahrenheit.";
  const labels = Object.fromEntries(Object.keys(englishPack.labels).map((key) => [key, `ES ${englishPack.labels[key]}`]));
  labels["ov.fever"] = "Fiebre de más de 101.5 °F";
  return {
    schema_version: "1.0",
    language: "es",
    script: "Latn",
    artifact_id: "ci-phase0",
    artifact_version: "0.1.0",
    status: "machine_draft",
    patient_use: false,
    sentences,
    labels,
    review: { kind: "none", label: "Borrador de traducción automática, aún sin revisar", date: "2026-09-18", receipt: null }
  };
}
const check = (pack) => validateLanguagePack({ pack, canonical: bundle.canonical, segments: bundle.segments, source: englishPack }).errors.join("\n");

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

test("every English label is required, including the labels drawn in the pictures, and no others", () => {
  const pack = spanishFixture();
  assert.equal(check(pack), "");
  delete pack.labels["ov.tape_check"];
  pack.labels["ov.invented"] = "x";
  pack.labels["ov.keep_dry"] = "Mantenga seco hasta tres días después";
  const errors = check(pack);
  assert.match(errors, /missing label ov\.tape_check/);
  assert.match(errors, /unknown label ov\.invented/);
  assert.match(errors, /label ov\.keep_dry lost protected value 3/);
});

test("the fever threshold keeps its direction and its unit in every language", () => {
  const noComparator = spanishFixture();
  noComparator.sentences["call.02"] = "Llame si tiene fiebre de 101.5 grados Fahrenheit.";
  assert.match(check(noComparator), /sentence call\.02 must keep one of: más de/);
  const noUnit = spanishFixture();
  noUnit.labels["ov.fever"] = "Fiebre de más de 101.5";
  assert.match(check(noUnit), /label ov\.fever must keep one of: °F, Fahrenheit/);
  const chinese = { ...spanishFixture(), language: "zh-Hans", script: "Hans" };
  chinese.sentences = { ...chinese.sentences, "call.02": "如果发烧超过华氏101.5度，请打电话。" };
  chinese.labels = { ...chinese.labels, "ov.fever": "发烧超过 101.5 °F" };
  assert.equal(check(chinese), "");
  chinese.sentences["call.02"] = "如果发烧华氏101.5度，请打电话。";
  assert.match(check(chinese), /sentence call\.02 must keep one of: 超过, 高于/);
});

test("a language without protected phrases cannot be added", () => {
  const french = { ...spanishFixture(), language: "fr" };
  assert.match(check(french), /no protected phrases are defined for fr/);
});
