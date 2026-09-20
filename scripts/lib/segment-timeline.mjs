import { createHash } from "node:crypto";

import { beatPlays, resolveRecord } from "./segments.mjs";
import { isSpacelessLanguage, speechEndSeconds, wordTimings } from "./narration-timing.mjs";

const CUE_BREAK = /[.;:!?…。；：！？，]$|—$/;
// A caption fills at most two lines of the export's band: about 58 characters of Latin text, about 30
// of Chinese. English sentences mostly fit one cue; longer translations split, and the split must not
// leave a cue hanging on an article or a preposition.
export const CUE_CHARACTERS = Object.freeze({ spaced: 52, spaceless: 30 });
// Chinese commas fall every few characters, so a Chinese caption ends only where a sentence does.
const CUE_BREAK_SPACELESS = /[。；：！？…]$/;
const HANGING = /^(the|a|an|and|or|of|to|in|on|for|with|your|el|la|los|las|un|una|del|de|y|o|con|sin|su|sus|por|para|que)$/i;
const round = (value) => Number(value.toFixed(3));

function recordHash(record) {
  return createHash("sha256").update(JSON.stringify({ text: record.text, timestamps: record.timestamps })).digest("hex");
}

export function joinWords(words) {
  return words.map((word, index) => word.text + ((word.space ?? true) && index < words.length - 1 ? " " : "")).join("");
}

const joiner = (previous, cue) => (/[\u3000-\u9fff]$/u.test(previous.text) || /^[\u3000-\u9fff]/u.test(cue.text) ? "" : " ");

export function groupCues(beatWords, beatId, maxWordsPerCue, startIndex, { maxChars = Infinity, firstWord = 0, avoidHanging = false, breakOn = CUE_BREAK } = {}) {
  const cues = [];
  let current = [];
  let cursor = firstWord;
  const flush = () => {
    if (!current.length) return;
    cues.push({
      id: `cue-${String(startIndex + cues.length + 1).padStart(2, "0")}`,
      start: current[0].start,
      end: current.at(-1).end,
      text: joinWords(current),
      beat: beatId,
      first_word: cursor,
      word_count: current.length
    });
    cursor += current.length;
    current = [];
  };
  for (const word of beatWords) {
    current.push(word);
    const full = current.length >= maxWordsPerCue || joinWords(current).length >= maxChars;
    // A cue ends on punctuation wherever it falls; a cue that is merely full hands a hanging word on.
    if (breakOn.test(word.text)) flush();
    else if (full) {
      const hanging = avoidHanging && current.length > 2 && HANGING.test(current.at(-1).text.replace(/[^\p{L}]/gu, ""));
      const carried = hanging ? current.pop() : null;
      flush();
      if (carried) current.push(carried);
    }
  }
  flush();
  // A few characters left over read as an orphan, so a short tail joins the caption before it.
  for (let index = cues.length - 1; index > 0; index -= 1) {
    const previous = cues[index - 1];
    const cue = cues[index];
    const joined = `${previous.text}${joiner(previous, cue)}${cue.text}`;
    if (cue.text.length * 3 > maxChars || joined.length > maxChars * 1.2) continue;
    if (/[.!?。！？]$/.test(previous.text)) continue;
    previous.text = joined;
    previous.end = cue.end;
    previous.word_count += cue.word_count;
    cues.splice(index, 1);
  }
  cues.forEach((cue, position) => { cue.id = `cue-${String(startIndex + position + 1).padStart(2, "0")}`; });
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].start < cues[index - 1].end) cues[index].start = cues[index - 1].end;
  }
  return cues;
}

export function buildSegmentTimeline({ segments, segment, records, language = "en", maxWordsPerCue = 14, audioFile = null, conditions = {}, variant = "" }) {
  const canvas = segments.canvas;
  const titleCard = { start: 0, end: round(canvas.title_card_seconds) };
  let clock = titleCard.end;
  const beats = [];
  const words = [];
  const cues = [];
  const sourceRecords = {};
  for (const beat of segment.beats) {
    if (!beatPlays(beat, conditions)) continue;
    const binding = beat.narration?.[language];
    if (!binding) continue;
    const record = resolveRecord(records, binding);
    if (!record) throw new Error(`${beat.id} references missing narration record ${binding.record_id}`);
    const speechSeconds = round(speechEndSeconds(record));
    const start = round(clock);
    const end = round(start + speechSeconds);
    const beatWords = wordTimings(record, language).map((word) => ({
      text: word.text,
      start: round(start + word.start),
      end: round(start + word.end),
      beat: beat.id,
      space: word.space
    }));
    const firstWord = words.length;
    words.push(...beatWords);
    const spaceless = isSpacelessLanguage(language);
    cues.push(...groupCues(beatWords, beat.id, maxWordsPerCue, cues.length, { maxChars: spaceless ? CUE_CHARACTERS.spaceless : CUE_CHARACTERS.spaced, firstWord, avoidHanging: !spaceless, breakOn: spaceless ? CUE_BREAK_SPACELESS : CUE_BREAK }));
    beats.push({
      id: beat.id,
      frame: beat.frame,
      sentence_ids: [...beat.sentence_ids],
      start,
      end,
      speech_seconds: speechSeconds,
      record_id: record.id,
      manifest: binding.manifest,
      source_audio: record.file,
      text: record.text
    });
    sourceRecords[record.id] = recordHash(record);
    clock = end + canvas.beat_gap_seconds;
  }
  const lastEnd = beats.length ? beats.at(-1).end : titleCard.end;
  return {
    schema_version: "1.0",
    segment_id: segment.id,
    number: segment.number,
    language,
    variant,
    canvas: { width: canvas.width, height: canvas.height, fps: canvas.fps },
    title_card: titleCard,
    beat_gap_seconds: canvas.beat_gap_seconds,
    tail_seconds: canvas.tail_seconds,
    audio_file: audioFile,
    beats,
    words,
    cues,
    narration_seconds: round(beats.reduce((sum, beat) => sum + beat.speech_seconds, 0)),
    duration_seconds: round(lastEnd + canvas.tail_seconds),
    source_records: sourceRecords
  };
}

export function vttTime(seconds) {
  const total = Math.round(seconds * 1000);
  const milliseconds = total % 1000;
  const wholeSeconds = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / 60000) % 60;
  const hours = Math.floor(total / 3600000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)}.${String(milliseconds).padStart(3, "0")}`;
}

export function toWebVtt(cues) {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue, index) => {
    lines.push(String(index + 1), `${vttTime(cue.start)} --> ${vttTime(cue.end)}`, cue.text, "");
  });
  return lines.join("\n");
}
