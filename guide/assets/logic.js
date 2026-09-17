// guide/assets/logic.js
// Pure helpers shared by the contents page and the player. No DOM, so Node tests import it directly.

export const LANGUAGES = Object.freeze([
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "zh-Hans", label: "中文（简体）" }
]);

export function normalizeLanguage(code) {
  return LANGUAGES.some((language) => language.code === code) ? code : "en";
}

export function parseFragment(hash) {
  const params = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  return Object.fromEntries(params.entries());
}

export function buildFragment(params) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "");
  return entries.length ? `#${new URLSearchParams(entries).toString()}` : "";
}

export function pickEntry(index, number, language) {
  const entries = (index?.entries ?? []).filter((entry) => entry.number === number);
  const exact = entries.find((entry) => entry.language === language);
  if (exact) return { entry: exact, fallback: false };
  const english = entries.find((entry) => entry.language === "en");
  return english ? { entry: english, fallback: language !== "en" } : { entry: null, fallback: false };
}

export function availableLanguages(index) {
  return [...new Set((index?.entries ?? []).map((entry) => entry.language))];
}

export function activeBeat(timeline, seconds) {
  if (seconds < timeline.title_card.end) return null;
  let current = null;
  for (const beat of timeline.beats) if (seconds >= beat.start) current = beat;
  return current;
}

export function activeCue(timeline, seconds) {
  let current = null;
  for (const cue of timeline.cues) if (seconds >= cue.start) current = cue;
  return current;
}

export function assignWordsToCues(timeline) {
  const assignment = new Map();
  let cursor = 0;
  for (const cue of timeline.cues) {
    const count = cue.text.split(/\s+/).filter(Boolean).length;
    assignment.set(cue.id, timeline.words.slice(cursor, cursor + count));
    cursor += count;
  }
  return assignment;
}

export function activeWordIndex(words, seconds) {
  let index = -1;
  words.forEach((word, position) => {
    if (seconds >= word.start) index = position;
  });
  return index;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function segmentByNumber(segments, number) {
  return segments.segments.find((segment) => segment.number === number) ?? null;
}

export function pendingConditionalBeats(segment) {
  return (segment?.beats ?? []).filter((beat) => typeof beat.condition === "string" && beat.status === "pending_clinician_text");
}

const SENTENCE_END = /[.?!]["')\]]*$/;

export function sentenceSpans(timeline) {
  const sentences = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.end = current.words.at(-1).end;
    current.text = current.words.map((word) => word.text).join(" ");
    sentences.push(current);
    current = null;
  };
  timeline.words.forEach((word, index) => {
    if (!current) {
      current = { id: `sent-${String(sentences.length + 1).padStart(2, "0")}`, beat: word.beat, start: word.start, end: word.end, words: [], text: "" };
    }
    current.words.push(word);
    const next = timeline.words[index + 1];
    if (SENTENCE_END.test(word.text) || !next || next.beat !== word.beat) flush();
  });
  flush();
  return sentences;
}

export function activeSentence(sentences, seconds) {
  let current = null;
  for (const sentence of sentences ?? []) if (seconds >= sentence.start) current = sentence;
  return current;
}

export function buildGuideClock(entries) {
  const sorted = [...entries].sort((left, right) => left.number - right.number);
  let offset = 0;
  const segments = sorted.map((entry) => {
    const segment = { number: entry.number, offset, duration: entry.duration_seconds };
    offset += entry.duration_seconds;
    return segment;
  });
  return { segments, total: offset };
}

export function globalToLocal(clock, seconds) {
  const time = Math.max(0, seconds);
  let segment = clock.segments[0];
  for (const candidate of clock.segments) if (time >= candidate.offset) segment = candidate;
  const local = Math.min(Math.max(0, time - segment.offset), segment.duration);
  return { number: segment.number, local: Number(local.toFixed(3)) };
}

export function localToGlobal(clock, number, local) {
  const segment = clock.segments.find((candidate) => candidate.number === number);
  return segment ? segment.offset + local : local;
}
