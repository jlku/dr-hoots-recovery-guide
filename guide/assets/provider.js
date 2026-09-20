// guide/assets/provider.js
// Reads the provider's dot-phrase block. Pure functions shared by the provider page and the tests.
// Only five lines drive the guide; every other line stays in the provider's note and is listed by name.
// A driving line that is present but unresolved, whether unreadable or an unfilled template list, needs
// a choice; so do two lines that disagree. A yes or a no is never guessed. Leaving the line out of the
// block is how a preset applies.

const LANGUAGE_NAMES = [
  [/^(english|inglés|ingles|英文|英语)$/iu, "en"],
  [/^(spanish|español|espanol|西班牙语)$/iu, "es"],
  [/^(mandarin|chinese|中文|普通话|简体中文)$/iu, "zh-Hans"]
];

// The words a clinician types for each driving line, after lowercasing and turning hyphens into spaces.
const FIELD_KEYS = {
  antibiotic: ["antibiotic", "antibiotics", "abx"],
  pain_medication: ["pain medication", "pain medications", "pain medicine", "pain meds", "pain med"],
  follow_up_date: ["follow up", "followup", "f/u", "fu"],
  language: ["video guide", "language", "lang", "guide language"]
};
export const FIELD_ORDER = ["antibiotic", "pain_medication", "follow_up_date", "language"];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\\.?";
const DATE_PATTERNS = [
  { pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/, read: (m) => [m[1], m[2], m[3]] },
  { pattern: /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/, read: (m) => [m[3].length === 2 ? `20${m[3]}` : m[3], m[1], m[2]] },
  { pattern: new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"), read: (m) => [m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, m[2]] },
  { pattern: new RegExp(`\\b(\\d{1,2})\\s+${MONTH},?\\s+(\\d{4})\\b`, "i"), read: (m) => [m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, m[1]] }
];

export function isPlaceholder(text) {
  const value = String(text ?? "");
  return value.includes("***") || /\{[^}]*\/[^}]*\}/.test(value);
}

export function parseYesNo(text) {
  const value = String(text ?? "").trim();
  if (!value || isPlaceholder(value)) return null;
  const bare = value.replace(/^\{|\}$/g, "").trim();
  if (/^(yes|y)\b/i.test(bare)) return true;
  if (/^(no|n|none)\b/i.test(bare) || /^not (needed|prescribed|indicated|required|given)\b/i.test(bare)) return false;
  return null;
}

// What follows the yes or no, such as a drug and dose. The guide does not show it; the page says so.
function yesNoDetails(text) {
  const bare = String(text ?? "").trim().replace(/^\{|\}$/g, "").trim();
  return bare.match(/^(?:yes|y|no|n|none)\b[\s:;,.-]*(.*)$/i)?.[1]?.trim() || null;
}

function findDate(text) {
  const value = String(text ?? "");
  for (const { pattern, read } of DATE_PATTERNS) {
    const match = value.match(pattern);
    if (!match) continue;
    const [year, month, day] = read(match).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { iso: date.toISOString().slice(0, 10), text: match[0] };
  }
  return null;
}

export function normalizeDate(text) {
  return findDate(text)?.iso ?? null;
}

function parseLanguage(text) {
  const value = String(text ?? "").replace(/^language\s*/i, "").trim();
  if (!value || /[{}]/.test(value)) return null;
  const word = value.split(/[\s,;]+/)[0];
  return LANGUAGE_NAMES.find(([pattern]) => pattern.test(word))?.[1] ?? null;
}

function parseReviewed(text) {
  const rest = String(text ?? "").replace(/^.*?reviewed by\s+/i, "");
  if (!rest || rest.includes("***")) return null;
  const date = findDate(rest);
  if (!date) return null;
  const by = rest.replace(date.text, "").replace(/\s+on\s*$/i, "").trim();
  return by ? { by, date: date.iso } : null;
}

function fieldFor(key) {
  return Object.entries(FIELD_KEYS).find(([, keys]) => keys.includes(key))?.[0] ?? null;
}

function readField(field, value) {
  if (field === "antibiotic" || field === "pain_medication") {
    const answer = parseYesNo(value);
    return answer === null ? null : { value: answer, details: yesNoDetails(value) };
  }
  if (field === "follow_up_date") {
    const date = normalizeDate(value);
    return date ? { value: date } : null;
  }
  const language = parseLanguage(value);
  return language ? { value: language } : null;
}

export function parseProviderBlock(text) {
  const seen = {};
  const unread = [];
  const other = [];
  const details = {};
  const needsChoice = new Set();
  const unclear = {};
  let reviewed = null;
  let previous = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z][A-Za-z /-]*?)\s*:\s*(.*)$/);
    const leadKey = match ? match[1].toLowerCase().replace(/[\s-]+/g, " ").trim() : null;
    // An indented line continues the line above it, unless it names one of the driving lines.
    if (/^\s/.test(raw) && previous && !(leadKey && fieldFor(leadKey))) {
      previous.text = `${previous.text} ${line}`;
      continue;
    }
    const reviewedAt = line.search(/reviewed by/i);
    const main = reviewedAt > 0 ? line.slice(0, reviewedAt).trim() : line;
    const keyed = main.match(/^([A-Za-z][A-Za-z /-]*?)\s*:\s*(.*)$/);
    const key = keyed ? keyed[1].toLowerCase().replace(/[\s-]+/g, " ").trim() : null;
    const value = keyed?.[2] ?? "";
    const field = key ? fieldFor(key) : null;
    if (field) {
      const read = readField(field, value);
      if (read) {
        (seen[field] ||= []).push({ value: read.value, line });
        if (read.details) details[field] = read.details;
      } else {
        unread.push(line);
        needsChoice.add(field);
        unclear[field] = line;
      }
      previous = { key, text: line };
    } else if (reviewedAt !== 0) {
      previous = { key, text: line };
      other.push(previous);
    }
    if (reviewedAt >= 0) {
      const parsed = parseReviewed(line.slice(reviewedAt));
      if (parsed) reviewed = parsed;
      else if (!line.slice(reviewedAt).includes("***")) unread.push(line);
    }
  }
  const fields = {};
  const conflicts = [];
  for (const [field, entries] of Object.entries(seen)) {
    const values = [...new Set(entries.map((entry) => entry.value))];
    if (values.length === 1 && !needsChoice.has(field)) fields[field] = values[0];
    else if (values.length > 1) {
      conflicts.push({ field, lines: entries.map((entry) => entry.line) });
      needsChoice.add(field);
    }
  }
  if (reviewed) fields.reviewed = reviewed;
  const unfilled = [...new Set(unread)].filter((line) => !Object.values(unclear).includes(line));
  return { fields, unread: [...new Set(unread)], unfilled, unclear, other, details, conflicts, needs_choice: FIELD_ORDER.filter((field) => needsChoice.has(field)) };
}

export function applyPresets(fields, presets) {
  const values = { ...fields };
  const fromPresets = [];
  for (const key of ["antibiotic", "pain_medication", "language", "follow_up_date"]) {
    if (!(key in fields)) {
      values[key] = presets[key];
      fromPresets.push(key);
    }
  }
  return { values, from_presets: fromPresets };
}

// Parameters live in the fragment, so nothing patient-specific reaches a server log. The only date
// is the clinic appointment; a reviewer's name never enters the link.
export function buildPatientLink(values, base = "guide/index.html") {
  const params = new URLSearchParams();
  params.set("a", values.antibiotic ? "1" : "0");
  params.set("p", values.pain_medication ? "1" : "0");
  if (values.follow_up_date) params.set("f", values.follow_up_date);
  params.set("l", values.language ?? "en");
  // The reviewer stays in the note. The patient's guide shows no reviewer line, so a link that carried
  // the date would promise a line that does not exist.
  return `${base}#${params.toString()}`;
}

// A dot-phrase line as the practice text would compare: no trailing source note, spacing, or case.
export function comparable(text) {
  return String(text ?? "").replace(/(\s*\([^()]*\))+\s*$/, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// For each line the guide does not use: "note" (stays in the note, such as the surgery date), "same" (the
// guide covers it in the practice's reviewed wording), "changed" (the guide covers it, but the provider
// changed it, so the patient will hear the guide's wording, not theirs), or "not_covered" (an instruction
// the guide has nothing for).
export function lineStatuses(other, { template = [], covered = {}, noteOnly = [] }) {
  const practice = new Map(template.filter((entry) => entry.key).map((entry) => [entry.key, comparable(entry.text)]));
  // The practice's own unlabeled lines, such as the .CIPOSTOP header, are notes. Anything else the
  // provider types without a label is an instruction they mean the patient to get.
  const headers = new Set(template.filter((entry) => !entry.key).map((entry) => comparable(entry.text)));
  return other.map((entry) => {
    const placeholder = isPlaceholder(entry.text);
    if (entry.key ? noteOnly.includes(entry.key) : headers.has(comparable(entry.text))) return { ...entry, status: "note", placeholder };
    if (!entry.key) return { ...entry, status: "not_covered", placeholder };
    if (covered[entry.key]) {
      return { ...entry, status: practice.get(entry.key) === comparable(entry.text) ? "same" : "changed", sentences: covered[entry.key], placeholder };
    }
    return { ...entry, status: "not_covered", placeholder };
  });
}

// What the guide says that the provider's block never mentions. Deleting a line from the note does not
// delete it from the guide, so the page lists these too.
export function missingFromBlock(other, { covered = {} }) {
  const mentioned = new Set(other.map((entry) => entry.key));
  return Object.entries(covered).filter(([key]) => !mentioned.has(key)).map(([key, sentences]) => ({ key, sentences }));
}

const LANGUAGE_WORDS = { en: "English", es: "Spanish", "zh-Hans": "Mandarin" };
const usDate = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${month}/${day}/${year}`;
};
const FIELD_LINES = {
  antibiotic: (value) => `Antibiotic: ${value ? "Yes" : "No"}`,
  pain_medication: (value) => `Pain medication: ${value ? "Yes" : "No"}`,
  follow_up_date: (value) => (value ? `Follow-up: wound check and ear exam on ${usDate(value)}` : null),
  language: (value) => `Video guide: language ${LANGUAGE_WORDS[value] ?? "English"}`
};

function keyOf(raw) {
  const line = raw.trim();
  const reviewedAt = line.search(/reviewed by/i);
  const main = reviewedAt > 0 ? line.slice(0, reviewedAt).trim() : line;
  const keyed = main.match(/^([A-Za-z][A-Za-z /-]*?)\s*:\s*(.*)$/);
  return keyed ? keyed[1].toLowerCase().replace(/[\s-]+/g, " ").trim() : null;
}

// Writes a choice made in the table back into the block, so the provider's note and the link agree.
// One line replaces every line for that field; a review line keeps its place.
// A provider's line often carries a note in the margin — "(UCSF CI Center: about 2 weeks;" with the rest
// of it on the indented line below. Rewriting the value must not take the margin with it and leave the
// indented half orphaned, because this text goes back into the chart.
// The margin keeps its column when the new value still fits, so the block reads the same in the chart.
const TRAILING_COMMENT = /\s\s+(\([^)]*\)?)\s*$/;
function trailingComment(line, next) {
  const match = TRAILING_COMMENT.exec(line);
  if (!match) return "";
  const column = line.length - match[0].length + match[0].search(/\S/);
  return `${" ".repeat(Math.max(4, column - next.length))}${match[1]}`;
}

// The map records more than the sentence ids now — which line owns them, and whether its numbers are
// practice-level — so everything that only needs the ids reads them through here.
export function coveredSentences(lineMap) {
  return Object.fromEntries(Object.entries(lineMap.covered).map(([key, entry]) => [key, entry.sentences]));
}

export function setFieldLine(text, field, value) {
  const lines = String(text ?? "").split(/\r?\n/);
  if (field === "reviewed") {
    const review = value ? `Reviewed by ${value.by} on ${usDate(value.date)}` : null;
    let placed = false;
    const out = [];
    for (const raw of lines) {
      const at = raw.search(/reviewed by/i);
      if (at < 0) {
        out.push(raw);
        continue;
      }
      const before = raw.slice(0, at).replace(/\s+$/, "");
      const next = placed || !review ? before : before ? `${before}    ${review}` : review;
      placed = placed || Boolean(review);
      if (next.trim()) out.push(next);
    }
    if (!placed && review) out.push(review);
    return out.join("\n");
  }
  const next = FIELD_LINES[field](value);
  let replaced = false;
  const out = [];
  for (const raw of lines) {
    const key = /^\s/.test(raw) ? null : keyOf(raw);
    if (key && fieldFor(key) === field) {
      const at = raw.search(/reviewed by/i);
      const review = at > 0 ? raw.slice(at).trim() : "";
      const margin = trailingComment(at > 0 ? raw.slice(0, at) : raw, next);
      const rewritten = `${next}${margin}${review ? `    ${review}` : ""}`;
      if (!replaced && next) out.push(rewritten);
      else if (review) out.push(review);
      replaced = true;
      continue;
    }
    out.push(raw);
  }
  if (!replaced && next) out.push(next);
  return out.join("\n");
}
