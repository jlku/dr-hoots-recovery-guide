// tests/v2-narration-generation.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { beatRecordId, beatText, narratedBeats, planNarration, validateNarrationText } from "../scripts/lib/v2-narration.mjs";
import { canonicalSentenceText } from "../scripts/lib/language-packs.mjs";
import { loadSegmentBundle } from "../scripts/lib/segments.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const pack = (language, end) => ({ language, sentences: Object.fromEntries(narratedBeats(bundle.segments).flatMap((beat) => beat.sentence_ids).map((id) => [id, `${language}:${id}${end}`])) });

test("a beat's narration is its sentences from the pack, spaced in Spanish and unspaced in Chinese", () => {
  const beat = narratedBeats(bundle.segments)[0];
  assert.equal(beatRecordId(beat), beat.id.replace(/^beat\//, ""));
  assert.equal(beatText(beat, pack("es", ".")), beat.sentence_ids.map((id) => `es:${id}.`).join(" "));
  assert.equal(beatText(beat, pack("zh-Hans", "。")), beat.sentence_ids.map((id) => `zh-Hans:${id}。`).join(""));
  assert.ok(narratedBeats(bundle.segments).some((item) => typeof item.condition === "string"), "a conditional beat with sentences is narrated too");
  assert.ok(narratedBeats(bundle.segments).every((item) => item.sentence_ids.length > 0));
});

test("the plan prices each beat, and keeps a beat whose recorded text and voice are unchanged", () => {
  const es = pack("es", ".");
  const voice = { voice: "George", language_code: "es" };
  const first = planNarration({ segments: bundle.segments, pack: es, voice, manifest: { records: [] } });
  assert.equal(first.length, narratedBeats(bundle.segments).length);
  assert.ok(first.every((item) => item.estimate_usd > 0 && !item.keep));
  const manifest = { records: [{ id: first[0].record_id, text: first[0].text, voice: "George", language_code: "es" }] };
  const second = planNarration({ segments: bundle.segments, pack: es, voice, manifest });
  assert.equal(second[0].keep, true);
  assert.equal(second[1].keep, false);
  const otherVoice = planNarration({ segments: bundle.segments, pack: es, voice: { voice: "Aria", language_code: "es" }, manifest });
  assert.equal(otherVoice[0].keep, false, "a new voice regenerates the beat");
});

test("translated narration must say exactly the pack's sentences, for every narrated beat", () => {
  const segments = structuredClone(bundle.segments);
  for (const narrated of narratedBeats(segments)) delete narrated.narration.es;
  const beat = narratedBeats(segments)[0];
  beat.narration.es = { manifest: "m.json", record_id: beatRecordId(beat) };
  const records = new Map([[`m.json#${beatRecordId(beat)}`, { id: beatRecordId(beat), text: "wrong", canonicalSentenceIds: beat.sentence_ids }]]);
  const errors = validateNarrationText({ segments, records, packs: [pack("es", ".")] }).join("\n");
  assert.match(errors, new RegExp(`${beat.id} es narration does not say the pack's sentences`));
  assert.match(errors, /es narration is missing for beat\//, "a language is complete or absent");
  const englishOnly = structuredClone(bundle.segments);
  for (const narrated of narratedBeats(englishOnly)) for (const language of Object.keys(narrated.narration)) if (language !== "en") delete narrated.narration[language];
  // English is checked too, against the canonical sentences the caller passes as the "en" pack.
  const english = { language: "en", sentences: Object.fromEntries(canonicalSentenceText(bundle.canonical)) };
  assert.deepEqual(validateNarrationText({ segments: englishOnly, records: bundle.records, packs: [english] }), [], "the English recording says the canonical sentences");
  assert.match(validateNarrationText({ segments: englishOnly, records: bundle.records, packs: [] }).join("\n"), /en narration has no pack to check it against/);
  assert.match(validateNarrationText({ segments: bundle.segments, records: bundle.records, packs: [english] }).join("\n"), /es narration has no pack to check it against/);
});
