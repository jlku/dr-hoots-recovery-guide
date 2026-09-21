// scripts/lib/v2-narration.mjs
// Narration for the translated packs: one track per beat, spoken from the pack's sentences through
// the same ElevenLabs v3 model as English, with the language code set.
import { isSpacelessLanguage } from "./narration-timing.mjs";
import { resolveRecord } from "./segments.mjs";
import { estimateNarrationUsd } from "./spend-ledger.mjs";

export const NARRATION_MODEL = "fal-ai/elevenlabs/tts/eleven-v3";

// Beats that are spoken: every beat with sentences, including a conditional beat that plays only in
// some variants. A conditional beat without sentences waits on the surgeon's wording.
export function narratedBeats(segments) {
  return segments.segments.flatMap((segment) => segment.beats).filter((beat) => beat.sentence_ids.length > 0);
}

export function beatRecordId(beat) {
  return beat.id.replace(/^beat\//, "");
}

export function narrationManifestPath(language) {
  return `assets/audio/v2/${language}/narration.json`;
}

export function beatText(beat, pack) {
  return beat.sentence_ids.map((id) => pack.sentences[id]).join(isSpacelessLanguage(pack.language) ? "" : " ");
}

export function planNarration({ segments, pack, voice, manifest }) {
  return narratedBeats(segments).map((beat) => {
    const recordId = beatRecordId(beat);
    const text = beatText(beat, pack);
    const existing = (manifest?.records ?? []).find((record) => record.id === recordId);
    return {
      beat_id: beat.id,
      record_id: recordId,
      text,
      sentence_ids: [...beat.sentence_ids],
      estimate_usd: estimateNarrationUsd(text.length),
      keep: Boolean(existing && existing.text === text && existing.voice === voice.voice && existing.language_code === voice.language_code)
    };
  });
}

// A translated language is narrated for every beat or for none, and each track must say exactly the
// pack's sentences, so an edited translation cannot keep stale audio.
// Every narrated language, English included: the recording has to say the sentences the guide shows.
// English is checked against the canonical sentences, which the caller passes as the "en" pack.
export function validateNarrationText({ segments, records, packs }) {
  const errors = [];
  const beats = narratedBeats(segments);
  const languages = new Set(beats.flatMap((beat) => Object.keys(beat.narration ?? {})));
  for (const language of languages) {
    const pack = packs.find((item) => item.language === language);
    for (const beat of beats) {
      const binding = beat.narration?.[language];
      if (!binding) {
        errors.push(`${language} narration is missing for ${beat.id}; a language is narrated for every beat or for none`);
        continue;
      }
      const record = resolveRecord(records, binding);
      if (!record) {
        errors.push(`${beat.id} ${language} narration record ${binding.record_id} is missing`);
        continue;
      }
      if (!pack) errors.push(`${language} narration has no pack to check it against`);
      else if (record.text !== beatText(beat, pack)) errors.push(`${beat.id} ${language} narration does not say the pack's sentences; regenerate it`);
    }
  }
  return errors;
}
