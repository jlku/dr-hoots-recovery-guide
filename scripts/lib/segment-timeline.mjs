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
// Words that read badly at the end of a caption: articles, conjunctions and prepositions in both
// languages, which belong to the phrase that follows them.
export const HANGING = /^(the|a|an|and|or|of|to|in|on|at|by|for|from|with|about|after|before|over|under|into|than|that|this|these|those|your|el|la|los|las|un|una|del|de|y|o|con|sin|su|sus|por|para|que|en|al|sobre|tras|hasta|desde|entre|hacia|cuando|si)$/i;
// A comma is a good place to end a caption once the caption has enough on it. Below that, breaking at
// every comma leaves scraps like "es decir," on a line of their own.
const SOFT_BREAK = /,$/;
const round = (value) => Number(value.toFixed(3));

function recordHash(record) {
  return createHash("sha256").update(JSON.stringify({ text: record.text, timestamps: record.timestamps })).digest("hex");
}

export function joinWords(words) {
  return words.map((word, index) => word.text + ((word.space ?? true) && index < words.length - 1 ? " " : "")).join("");
}

const joiner = (previous, cue) => (/[\u3000-\u9fff]$/u.test(previous.text) || /^[\u3000-\u9fff]/u.test(cue.text) ? "" : " ");

export function groupCues(beatWords, beatId, maxWordsPerCue, startIndex, { maxChars = Infinity, firstWord = 0, avoidHanging = false, softBreak = false, breakOn = CUE_BREAK } = {}) {
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
  // A cue that is merely full hands its hanging words on to the next one — all of them, since "sobre
  // la" and "de la" run in pairs. A word that carries punctuation ends a clause and never hangs.
  const hanging = (word) => /\p{L}$/u.test(word.text) && HANGING.test(word.text);
  const flushCarrying = () => {
    const carried = [];
    while (avoidHanging && current.length > 2 && hanging(current.at(-1))) carried.unshift(current.pop());
    flush();
    current.push(...carried);
  };
  for (const word of beatWords) {
    // The word that would take the cue past its budget starts the next cue instead. Measuring after
    // adding it let a cue run over by a whole word: a Spanish caption came out at 61 characters
    // against a budget of 52, and read as a sentence cut in half.
    if (current.length && joinWords([...current, word]).length > maxChars) flushCarrying();
    current.push(word);
    // A cue ends on punctuation wherever it falls, and on a comma once it is at least half full: a
    // clause of its own reads better than a line that runs to the budget and splits a phrase.
    if (breakOn.test(word.text)) flush();
    else if (softBreak && SOFT_BREAK.test(word.text) && joinWords(current).length * 2 >= maxChars) flush();
    else if (current.length >= maxWordsPerCue) flushCarrying();
  }
  flush();
  // A few characters left over read as an orphan. It joins the caption before it when both fit inside
  // the budget; when they do not, the caption before it hands words back until neither is a scrap. A
  // hard budget without this leaves Chinese cues ending on two characters and a full stop.
  const orphan = (text) => Number.isFinite(maxChars) && text.length * 3 <= maxChars;
  const groups = cues.map((cue) => beatWords.slice(cue.first_word - firstWord, cue.first_word - firstWord + cue.word_count));
  for (let index = groups.length - 1; index > 0; index -= 1) {
    const previous = groups[index - 1];
    const group = groups[index];
    if (!orphan(joinWords(group))) continue;
    const joined = `${joinWords(previous)}${joiner({ text: joinWords(previous) }, { text: joinWords(group) })}${joinWords(group)}`;
    if (joined.length <= maxChars && !/[.!?。！？]$/.test(joinWords(previous))) {
      previous.push(...group);
      groups.splice(index, 1);
      continue;
    }
    // A caption that already ends a sentence is at the best break there is; nothing moves across it.
    if (/[.!?。！？]$/.test(joinWords(previous))) continue;
    while (previous.length > 1 && orphan(joinWords(group)) && joinWords([previous.at(-1), ...group]).length <= maxChars) {
      group.unshift(previous.pop());
    }
    while (avoidHanging && previous.length > 1 && hanging(previous.at(-1)) && joinWords([previous.at(-1), ...group]).length <= maxChars) {
      group.unshift(previous.pop());
    }
  }
  cues.length = 0;
  let index = firstWord;
  for (const group of groups) {
    cues.push({
      id: `cue-${String(startIndex + cues.length + 1).padStart(2, "0")}`,
      start: group[0].start,
      end: group.at(-1).end,
      text: joinWords(group),
      beat: beatId,
      first_word: index,
      word_count: group.length
    });
    index += group.length;
  }
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
    cues.push(...groupCues(beatWords, beat.id, maxWordsPerCue, cues.length, { maxChars: spaceless ? CUE_CHARACTERS.spaceless : CUE_CHARACTERS.spaced, firstWord, avoidHanging: !spaceless, softBreak: !spaceless, breakOn: spaceless ? CUE_BREAK_SPACELESS : CUE_BREAK }));
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
