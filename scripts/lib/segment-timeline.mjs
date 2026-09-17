import { createHash } from "node:crypto";

import { resolveRecord } from "./segments.mjs";
import { speechEndSeconds, wordTimings } from "./narration-timing.mjs";

const CUE_BREAK = /[.;:!?…]$|—$/;
const round = (value) => Number(value.toFixed(3));

function recordHash(record) {
  return createHash("sha256").update(JSON.stringify({ text: record.text, timestamps: record.timestamps })).digest("hex");
}

export function groupCues(beatWords, beatId, maxWordsPerCue, startIndex) {
  const cues = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    cues.push({
      id: `cue-${String(startIndex + cues.length + 1).padStart(2, "0")}`,
      start: current[0].start,
      end: current.at(-1).end,
      text: current.map((word) => word.text).join(" "),
      beat: beatId
    });
    current = [];
  };
  for (const word of beatWords) {
    current.push(word);
    if (current.length >= maxWordsPerCue || CUE_BREAK.test(word.text)) flush();
  }
  flush();
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].start < cues[index - 1].end) cues[index].start = cues[index - 1].end;
  }
  return cues;
}

export function buildSegmentTimeline({ segments, segment, records, language = "en", maxWordsPerCue = 8, audioFile = null }) {
  const canvas = segments.canvas;
  const titleCard = { start: 0, end: round(canvas.title_card_seconds) };
  let clock = titleCard.end;
  const beats = [];
  const words = [];
  const cues = [];
  const sourceRecords = {};
  for (const beat of segment.beats) {
    const binding = beat.narration?.[language];
    if (!binding) continue;
    const record = resolveRecord(records, binding);
    if (!record) throw new Error(`${beat.id} references missing narration record ${binding.record_id}`);
    const speechSeconds = round(speechEndSeconds(record));
    const start = round(clock);
    const end = round(start + speechSeconds);
    const beatWords = wordTimings(record).map((word) => ({
      text: word.text,
      start: round(start + word.start),
      end: round(start + word.end),
      beat: beat.id
    }));
    words.push(...beatWords);
    cues.push(...groupCues(beatWords, beat.id, maxWordsPerCue, cues.length));
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
