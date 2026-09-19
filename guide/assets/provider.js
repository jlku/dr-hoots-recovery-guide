// guide/assets/provider.js
// Reads the provider's dot-phrase block. Pure functions shared by the provider page and the tests.
// Only five lines drive the guide; every other line stays in the provider's note. An unreadable
// driving line is listed and its preset applies: a yes or a no is never guessed.

const LANGUAGE_NAMES = [
  [/^(english|inglés|ingles|英文|英语)$/iu, "en"],
  [/^(spanish|español|espanol|西班牙语)$/iu, "es"],
  [/^(mandarin|chinese|中文|普通话|简体中文)$/iu, "zh-Hans"]
];

export function parseYesNo(text) {
  const value = String(text ?? "").trim();
  if (!value || value.includes("***") || /\{[^}]*\/[^}]*\}/.test(value)) return null;
  const bare = value.replace(/^\{|\}$/g, "").trim();
  if (/^(yes|y)\b/i.test(bare)) return true;
  if (/^(no|n)\b/i.test(bare)) return false;
  return null;
}

export function normalizeDate(text) {
  const value = String(text ?? "");
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const us = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  let year;
  let month;
  let day;
  if (iso) [, year, month, day] = iso.map(Number);
  else if (us) {
    [, month, day, year] = us.map(Number);
    if (year < 100) year += 2000;
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function parseLanguage(text) {
  const value = String(text ?? "").replace(/^language\s*/i, "").trim();
  if (!value || /[{}]/.test(value)) return null;
  const word = value.split(/[\s,;]+/)[0];
  return LANGUAGE_NAMES.find(([pattern]) => pattern.test(word))?.[1] ?? null;
}

function parseReviewed(text) {
  const match = String(text ?? "").match(/reviewed by\s+(.+?)\s+on\s+(.+)$/i);
  if (!match || match[1].includes("***")) return null;
  const date = normalizeDate(match[2]);
  return date ? { by: match[1].trim(), date } : null;
}

export function parseProviderBlock(text) {
  const fields = {};
  const unread = [];
  let other = 0;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const reviewedAt = line.search(/reviewed by/i);
    const main = reviewedAt > 0 ? line.slice(0, reviewedAt).trim() : line;
    const match = main.match(/^([A-Za-z][A-Za-z -]*?):\s*(.*)$/);
    const key = match?.[1].toLowerCase().replace(/[\s-]+/g, " ").trim();
    const value = match?.[2] ?? "";
    let driving = true;
    let readable = true;
    if (key === "antibiotic" || key === "antibiotics") {
      const answer = parseYesNo(value);
      readable = answer !== null;
      if (readable) fields.antibiotic = answer;
    } else if (key === "pain medication" || key === "pain medicine") {
      const answer = parseYesNo(value);
      readable = answer !== null;
      if (readable) fields.pain_medication = answer;
    } else if (key === "follow up" || key === "followup") {
      const date = normalizeDate(value);
      readable = Boolean(date);
      if (date) fields.follow_up_date = date;
    } else if (key === "video guide") {
      const language = parseLanguage(value);
      readable = Boolean(language);
      if (language) fields.language = language;
    } else {
      driving = reviewedAt === 0;
    }
    if (reviewedAt >= 0) {
      const reviewed = parseReviewed(line.slice(reviewedAt));
      if (reviewed) fields.reviewed = reviewed;
      else if (!line.slice(reviewedAt).includes("***")) unread.push(line);
    }
    if (driving && !readable) unread.push(line);
    else if (!driving) other += 1;
  }
  return { fields, unread: [...new Set(unread)], other };
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
  if (values.reviewed?.date) params.set("r", values.reviewed.date);
  return `${base}#${params.toString()}`;
}
