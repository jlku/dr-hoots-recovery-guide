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

// Conditions the provider's block can switch, and the fragment parameter each one travels in. These
// mirror CONDITION_PARAMS in scripts/lib/segments.mjs.
const CONDITION_PARAMS = Object.freeze({ antibiotic: "a", pain_medication: "p" });

// Segment 2's variant from the link: a flag present in the link wins, otherwise its preset.
export function variantFor(params = {}, presets = {}) {
  return Object.entries(CONDITION_PARAMS)
    .sort(([, left], [, right]) => left.localeCompare(right))
    .map(([condition, key]) => `${key}${params[key] === "1" ? 1 : params[key] === "0" ? 0 : presets[condition] === false ? 0 : 1}`)
    .join("");
}

export function conditionsFor(variant) {
  return Object.fromEntries(Object.entries(CONDITION_PARAMS).map(([condition, key]) => [condition, variant.includes(`${key}1`)]));
}

// One media entry per segment: the requested language, or English with a fallback flag. A segment with
// variants plays the requested one, or, without one, the variant where every conditional beat plays.
export function pickEntry(index, number, language, variant = "") {
  const all = (index?.entries ?? []).filter((entry) => entry.number === number);
  const variants = [...new Set(all.map((entry) => entry.variant ?? ""))].filter(Boolean).sort();
  const wanted = variants.length ? (variants.includes(variant) ? variant : variants.at(-1)) : "";
  const entries = all.filter((entry) => (entry.variant ?? "") === wanted);
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

export function joinWords(words) {
  return words.map((word, index) => word.text + ((word.space ?? true) && index < words.length - 1 ? " " : "")).join("");
}

// Each cue records which words it holds, because Chinese cues cannot be counted by their spaces.
// Timelines built before that fall back to counting.
export function assignWordsToCues(timeline) {
  const assignment = new Map();
  let cursor = 0;
  for (const cue of timeline.cues) {
    const first = Number.isInteger(cue.first_word) ? cue.first_word : cursor;
    const count = Number.isInteger(cue.word_count) ? cue.word_count : cue.text.split(/\s+/).filter(Boolean).length;
    assignment.set(cue.id, timeline.words.slice(first, first + count));
    cursor = first + count;
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

// Beats whose wording waits on the surgeon: a conditional beat with no sentences yet, or a conditional
// beat the link switched off whose "no" wording is still pending.
export function pendingConditionalBeats(segment, conditions = {}) {
  return (segment?.beats ?? []).filter((beat) => typeof beat.condition === "string" && (
    ((beat.sentence_ids ?? []).length === 0 && beat.status === "pending_clinician_text") ||
    (conditions[beat.condition] === false && beat.when_false === "pending_clinician_text")
  ));
}

const SENTENCE_END = /[.?!。？！]["')\]”’」』）]*$/;

export function sentenceSpans(timeline) {
  const sentences = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    current.end = current.words.at(-1).end;
    current.text = joinWords(current.words);
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

// The status strip: a visible notice when a language fell back to English, a note when a medication
// the link switched off still waits on the surgeon's wording, and, whenever a translation is showing,
// who reviewed it. AI review is always labeled as AI. None of these enters the reading flow.
export function statusMessages({ pack, fallback, labels }) {
  const messages = [];
  if (fallback) messages.push(labels["ui.language_fallback"]);
  // A translation no reviewer has passed says so; a reviewed one says nothing, and who reviewed it
  // belongs on the provider page, not in front of the patient.
  if (pack?.status === "machine_draft" && pack?.review?.label) messages.push(pack.review.label);
  return messages.filter(Boolean);
}

// The follow-up date is live text in the patient's language; it never passes through narration.
export function formatFollowUp(date, language) {
  const [year, month, day] = String(date).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Intl.DateTimeFormat(language, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}


// Segments that are the same for every patient: no beat depends on the provider's link and no frame
// draws a patient's data. Only these export as video.
export function fixedSegments(segments) {
  return segments.filter((segment) => !(segment.data_fields ?? []).length && !(segment.beats ?? []).some((beat) => beat.condition));
}

// Pictures are static, so a video of a segment is a sequence of stills that change only where the
// title card ends, a beat starts, a caption starts, or a spoken word starts.
export function exportChangePoints(timeline) {
  const times = [0, timeline.title_card.end, ...timeline.beats.map((beat) => beat.start), ...timeline.cues.map((cue) => cue.start), ...timeline.words.map((word) => word.start)];
  return [...new Set(times.filter((time) => time >= 0 && time < timeline.duration_seconds))].sort((a, b) => a - b);
}
