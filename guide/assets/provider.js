// guide/assets/provider.js
// Reads the provider's dot-phrase block. Pure functions shared by the provider page and the tests.
// Only five lines drive the guide; every other line stays in the provider's note and is listed by name.
// A driving line that is present but unresolved, whether unreadable or an unfilled template list, needs
// a choice; so do two lines that disagree. A yes or a no is never guessed. Leaving the line out asks the
// same question: until a clinic approves its presets, an absent line has no author and no value, and the
// page offers the draft default by name rather than applying it in silence.

const LANGUAGE_NAMES = [
  [/^(english|inglés|ingles|英文|英语)$/iu, "en"],
  [/^(spanish|español|espanol|西班牙语)$/iu, "es"],
  [/^(mandarin|chinese|中文|普通话|简体中文)$/iu, "zh-Hans"]
];

// The words a clinician types for each driving line, after lowercasing and turning hyphens into spaces.
// Measured against 25 real published post-operative handouts, not guessed. "Pain:" alone is the single
// most common field label in that corpus and was missing; "pain meds", "f/u" and "abx" appear zero times
// between them, and are kept only because a clinician typing our own draft may use them.
const FIELD_KEYS = {
  antibiotic: ["antibiotic", "antibiotics", "abx"],
  pain_medication: ["pain", "pain medication", "pain medications", "pain medicine", "pain meds", "pain med", "pain control", "dealing with pain", "pain and discomfort", "pain management"],
  follow_up_date: ["follow up", "followup", "f/u", "fu", "follow up visit", "follow up visits", "follow up appointment", "follow up appointments", "return to clinic", "rtc"],
  language: ["video guide", "language", "lang", "guide language"]
};
export const FIELD_ORDER = ["antibiotic", "pain_medication", "follow_up_date", "language"];

// Only a label that names a MEDICINE may settle a yes or a no from its value. "Pain:" is a symptom
// heading as often as a medication one — one handout in the corpus opens it "Pain: Expect a mild-to-
// moderate amount of pain" — so "Pain: none" is a pain score, not a statement that nothing was
// prescribed, and "Pain: Yes" is a patient reporting pain. Reading either as an answer silently drops or
// adds a narrated instruction. A non-answering label is still recognised: it just has to be asked about.
const ANSWERING_KEYS = new Set(["antibiotic", "antibiotics", "abx", "pain medication", "pain medications", "pain medicine", "pain meds", "pain med"]);

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

// No real handout carries a bookable appointment. Across 25 published post-operative instructions, 19
// state a follow-up and 0 state a date: every one is an interval, and half tell the patient to phone and
// book it themselves. Demanding a date was demanding something the source never contains.
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const COUNT = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)";
const INTERVAL = new RegExp(`\\b${COUNT}(?:\\s*(?:-|\\u2013|to)\\s*${COUNT})?\\s+(day|week|month)s?\\b`, "i");

export function readInterval(text) {
  const match = String(text ?? "").match(INTERVAL);
  if (!match) return null;
  const count = (word) => (word ? NUMBER_WORDS[word.toLowerCase()] ?? Number(word) : null);
  const from = count(match[1]);
  const to = count(match[2]);
  if (!Number.isFinite(from)) return null;
  const unit = match[3].toLowerCase();
  const days = { day: 1, week: 7, month: 30 }[unit];
  return {
    text: match[0].replace(/\s+/g, " ").trim(),
    unit,
    from,
    to: Number.isFinite(to) ? to : from,
    days_from: from * days,
    days_to: (Number.isFinite(to) ? to : from) * days
  };
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

function readField(field, value, key) {
  if (field === "antibiotic" || field === "pain_medication") {
    if (key && !ANSWERING_KEYS.has(key)) return null;
    const answer = parseYesNo(value);
    return answer === null ? null : { value: answer, details: yesNoDetails(value) };
  }
  if (field === "follow_up_date") {
    const date = normalizeDate(value);
    if (date) return { value: date };
    // An interval is a readable answer meaning "no date yet", not a line the page failed to read.
    const interval = readInterval(value);
    return interval ? { value: null, interval } : null;
  }
  const language = parseLanguage(value);
  return language ? { value: language } : null;
}

// Reading what a note says about a medicine, without ever deciding the answer from it.
//
// Three adversaries attacked a 34-rule classifier that tried to answer yes or no from prose. They broke
// it 24 times, and the four worst breaks were silent wrong answers on REAL hospital text: "We do not
// prescribe narcotics after this operation; you will be given tramadol" read as no; "We do not prescribe
// an antibiotic before surgery" read as no for the discharge course; a medication list read as no because
// 20 of 22 common ENT antibiotics were not in the pattern. Measured over 25 real documents, the whole
// classifier produced 2 definite answers in 50 reads — so it bought almost no answers and carried every
// one of those risks.
//
// So this reads EVIDENCE, never an answer. The clinician still decides. The worst thing a mistake here
// can do is quote the wrong sentence or fail to quote a relevant one; it cannot put a sentence in a
// patient's ear. What it buys is a page that tells the truth about why it is asking: "your note does not
// mention this" and "your note says it depends" are different facts, and so is "your note talks about
// ointment for the incision, which is a different thing".
const CLASS_TOKENS = {
  antibiotic: /\bantibiotics?\b|\b(cephalexin|keflex|amoxicillin|augmentin|clindamycin|azithromycin|zithromax|doxycycline|cefuroxime|cefdinir|cefadroxil|levofloxacin|ciprofloxacin|bactrim|sulfamethoxazole|ciprodex|ofloxacin)\b/i,
  pain_medication: /\bpain (medicines?|medications?|meds?|pills?|relievers?|killers?)\b|\b(medicines?|medications?|pills?) (for|to help with) (the )?pain\b|\b(analgesics?|narcotics?|opioids?)\b|\b(tylenol|acetaminophen|ibuprofen|motrin|advil|naproxen|aleve|oxycodone|hydrocodone|percocet|vicodin|norco|tramadol|codeine)\b/i
};
// A route this guide's antibiotic sentence is not about. The guide already narrates the ointment in its
// wound-care chapter, so a sentence about it is not silence and not an answer either.
const TOPICAL = /\b(ointments?|creams?|salves?|gels?|drops?|otic|topical)\b|\b(bacitracin|polysporin|neosporin|mupirocin|bactroban)\b|\btriple antibiotic\b/i;
const APPLYING = /\b(apply|applied|applying|application|coat|coated|dab|smear|instill)\b|\bcotton ball\b/i;
// Sentences that mention a medicine without being an instruction to take one.
const RESTRICTION = /\b(driv\w*|machinery|vehicle|operate|flying|fly|alcohol)\b/i;
const AVOIDING = /\b(avoid|do not take|don'?t take|refrain from|stop taking|hold)\b/i;
const STEWARDSHIP = /\bresistan(ce|t)\b|\bused too often\b|\bwork on infections?\b|\bantibiotic use\b/i;
const SECOND_PERSON = /\b(you|your)\b/i;
const STATISTIC = /\d+\s*(?:-\s*\d+\s*)?%/;
const SYMPTOM_CALL = /\b(call|notify|report|emergency)\b/i;
const PLACEHOLDER = /\*\*\*|_{3,}|\[[^\]]{2,40}\]|\{[^}]*\/[^}]*\}/;

// A PDF wraps a sentence across lines, and a break in the middle of one is not a boundary. Splitting
// there quoted a clinician's "You will not routinely receive an antibiotic because there are antibiotics
// in the ear canal" back to them as "an antibiotic because there are antibiotics in the ear canal" — the
// negation gone and the meaning reversed, in a sentence the page was about to ask them to trust.
function unwrap(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }
    const previous = out.at(-1);
    const continues = previous
      && !/[.!?:;]$/.test(previous)
      && !/^[•▪●*\-]|^\d+[.)]|^[A-Za-z][A-Za-z /-]{0,28}:/.test(line)
      && !/^[A-Z][A-Z \d.,'()/-]{6,}$/.test(line);
    if (continues) out[out.length - 1] = `${previous} ${line}`;
    else out.push(line);
  }
  return out.join("\n");
}

// Sentences, bullets and rows — never split at a comma, which would cut a hedge from its imperative.
function segments(text) {
  return unwrap(text)
    .split(/(?<=[.!?])\s+(?=[A-Z•])|\n+|(?:^|\s)[•▪●*]\s+/u)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 2);
}

export function readMedicationEvidence(text, field) {
  const token = CLASS_TOKENS[field];
  if (!token) return { state: "unmentioned", quote: "" };
  let topical = "";
  for (const segment of segments(text)) {
    if (!token.test(segment)) continue;
    // Everything below only silences a quote. None of it can produce an answer.
    if (TOPICAL.test(segment) || APPLYING.test(segment)) {
      topical = topical || segment;
      continue;
    }
    if (STATISTIC.test(segment)) continue;
    if (STEWARDSHIP.test(segment) && !SECOND_PERSON.test(segment)) continue;
    if (RESTRICTION.test(segment) && /\b(while|when|until|after)\b/i.test(segment)) continue;
    if (AVOIDING.test(segment) && !/\bprescri/i.test(segment)) continue;
    if (SYMPTOM_CALL.test(segment) && !/\bprescri|\btake\b/i.test(segment)) continue;
    if (PLACEHOLDER.test(segment)) continue;
    return { state: "unsettled", quote: segment };
  }
  return topical ? { state: "topical_only", quote: topical } : { state: "unmentioned", quote: "" };
}

export function parseProviderBlock(text) {
  const seen = {};
  const unread = [];
  const other = [];
  const details = {};
  const intervals = {};
  const needsChoice = new Set();
  const unclear = {};
  let reviewed = null;
  let previous = null;
  // Whether the line a continuation would attach to is one the page shows back. A driving line is a
  // value, not a sentence any list renders, so text appended to it used to disappear from the page
  // entirely: an indented "do not take ibuprofen or any NSAID for 10 days" under "Antibiotic: Yes"
  // appeared in no list at all. Nothing the clinician wrote may vanish.
  let previousShown = false;
  const all = String(text ?? "").split(/\r?\n/);
  // A label alone on its line, with its instruction in the block beneath, is the commonest shape in real
  // handouts: 12 of 25. The block is read as that label's value, and still shown as its own lines, so
  // nothing is hidden and nothing is counted as missing that the clinician can plainly see.
  const blockUnder = (start) => {
    const body = [];
    for (let index = start + 1; index < all.length; index += 1) {
      const next = all[index];
      if (!next.trim()) break;
      const bare = stripBullet(next.trim());
      const bulleted = next !== stripBullet(next) || /^\s/.test(next);
      if (!bulleted) break;
      if (bare.match(/^([A-Za-z][A-Za-z /-]*?)\s*:\s*(.*)$/) && fieldFor(bare.split(":")[0].toLowerCase().replace(/[\s-]+/g, " ").trim())) break;
      body.push(bare);
      if (body.length >= 6) break;
    }
    return body.join(" ");
  };
  for (let position = 0; position < all.length; position += 1) {
    const raw = all[position];
    const line = raw.trim();
    if (!line) continue;
    // The bullet is stripped to read the line, never to show it: the clinician's words are displayed
    // exactly as they wrote them, glyph and all.
    const bare = stripBullet(line);
    const match = bare.match(/^([A-Za-z][A-Za-z /-]*?)\s*:\s*(.*)$/);
    const leadKey = match ? match[1].toLowerCase().replace(/[\s-]+/g, " ").trim() : null;
    // An indented line continues the line above it, unless it names one of the driving lines.
    if (/^\s/.test(raw) && previous && !(leadKey && fieldFor(leadKey))) {
      if (previousShown) {
        previous.text = `${previous.text} ${line}`;
        continue;
      }
      // Under a driving line it stands on its own and the classifier decides what it is. A dose read
      // as an instruction is noise; an instruction read as nothing is how a warning disappeared.
      previous = { key: null, text: line };
      previousShown = true;
      other.push(previous);
      continue;
    }
    const reviewedAt = line.search(/reviewed by/i);
    const bareReviewedAt = bare.search(/reviewed by/i);
    const main = bareReviewedAt > 0 ? bare.slice(0, bareReviewedAt).trim() : bare;
    const keyed = main.match(/^([A-Za-z][A-Za-z /-]*?)\s*:\s*(.*)$/);
    const key = keyed ? keyed[1].toLowerCase().replace(/[\s-]+/g, " ").trim() : null;
    const value = keyed?.[2] ?? "";
    const field = key ? fieldFor(key) : null;
    if (field) {
      // An empty value means the instruction is in the block below the label, not missing.
      const effective = value.trim() ? value : blockUnder(position);
      const read = readField(field, effective, key);
      if (read) {
        (seen[field] ||= []).push({ value: read.value, line });
        if (read.details) details[field] = read.details;
        // The clinician's own line is kept with it, so the page can quote them rather than a fragment.
        if (read.interval) intervals[field] = { ...read.interval, line };
      } else {
        unread.push(line);
        needsChoice.add(field);
        unclear[field] = value.trim() ? line : `${line} ${blockUnder(position)}`.trim();
      }
      previous = { key, text: line };
      previousShown = false;
    } else if (reviewedAt !== 0) {
      previous = { key, text: line };
      previousShown = true;
      other.push(previous);
    }
    if (reviewedAt >= 0) {
      const parsed = parseReviewed(line.slice(reviewedAt));
      if (parsed) reviewed = parsed;
      else if (!line.slice(reviewedAt).includes("***")) unread.push(line);
    }
  }
  const evidence = {};
  for (const field of ["antibiotic", "pain_medication"]) evidence[field] = readMedicationEvidence(text, field);
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
  return { fields, unread: [...new Set(unread)], unfilled, unclear, other, details, intervals, evidence, conflicts, needs_choice: FIELD_ORDER.filter((field) => needsChoice.has(field)) };
}

// A preset answers a line the block leaves out — but only once a clinic has approved it. Until then the
// page may offer it in one click and may not apply it silently: a value nobody authored must never become
// a sentence a patient hears. A prose note whose own words were "We did not send you home on an
// antibiotic" used to produce a=1 from this file, because saying nothing and saying no looked the same.
// A preset of null asserts nothing, so it needs no author.
export function applyPresets(fields, presets, { approved = true } = {}) {
  const values = { ...fields };
  const fromPresets = [];
  const unauthored = [];
  for (const key of ["antibiotic", "pain_medication", "language", "follow_up_date"]) {
    if (key in fields) continue;
    if (!approved && presets[key] !== null) {
      unauthored.push(key);
      continue;
    }
    values[key] = presets[key];
    fromPresets.push(key);
  }
  return { values, from_presets: fromPresets, unauthored, offers: presets };
}

// Parameters live in the fragment, so nothing patient-specific reaches a server log. The only date
// is the clinic appointment; a reviewer's name never enters the link.
export function buildPatientLink(values, base = "guide/index.html") {
  // A missing value is not a no. Coercing one would turn "this page found nothing" into "the patient was
  // prescribed nothing", which is the same sentence to the patient and the opposite fact.
  for (const key of ["antibiotic", "pain_medication", "language"]) {
    if (values[key] === undefined || values[key] === null) throw new Error(`buildPatientLink: ${key} has no value; a link may not be built from a value nobody authored`);
  }
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

// A leading bullet, dash or list number is decoration, not part of the label. Real handouts print
// "\u2022 Antibiotics:", "3. Medication:" and "1. Dressing:"; without this the glyph alone defeated the
// two verbatim matches the closed list did have.
const BULLET = /^\s*(?:[\u2022\u2023\u25aa\u25cf\u25cb\u00b7*+\u2013\u2014-]|\(?\d{1,2}[.)]|\(?[a-f][.)])\s+/;
export function stripBullet(line) {
  return String(line ?? "").replace(BULLET, "");
}

function keyOf(raw) {
  const line = stripBullet(raw.trim());
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

// Writing a value back into the block rewrites the token that holds it and nothing else. It used to
// rebuild the whole line from a template, so clicking No on "Antibiotic: Yes cephalexin 500 mg, 7 days"
// destroyed the drug, the dose and the duration — text that goes back into the patient's chart. The only
// thing with authority to delete a clinician's prose is the clinician.
//
// Three outcomes, and the page says which happened:
//   "rewrote"  the page found its token and replaced it, keeping every other word on the line
//   "added"    there was no line for this field, so one was added above the signature
//   "kept"     the line says something the page cannot read as a value, so it was left exactly as it is
const ANSWER_TOKEN = /^(yes|y|no|n|none|not\s+(?:needed|prescribed|indicated|required|given))\b/i;
const BRACED = /\{[^}]*\}/;

function answerWord(value) {
  return value ? "Yes" : "No";
}

// Where the value sits on the line, without its margin note or its review suffix.
function splitLine(raw) {
  const reviewedAt = raw.search(/reviewed by/i);
  const body = reviewedAt > 0 ? raw.slice(0, reviewedAt) : raw;
  const review = reviewedAt > 0 ? raw.slice(reviewedAt).trim() : "";
  const match = body.match(/^(\s*[A-Za-z][A-Za-z /-]*?\s*:\s*)([\s\S]*)$/);
  if (!match) return null;
  const marginAt = match[2].search(/\s\s+\([^)]*\)?\s*$/);
  const value = marginAt >= 0 ? match[2].slice(0, marginAt) : match[2].replace(/\s+$/, "");
  const margin = marginAt >= 0 ? match[2].slice(marginAt).trim() : "";
  // Where the margin note starts on the untouched line, so it can keep its column.
  const column = marginAt >= 0 ? match[1].length + match[2].slice(0, marginAt).length + match[2].slice(marginAt).search(/\S/) : 0;
  return { label: match[1], value, margin, column, review };
}

function joinLine({ label, value, margin, column, review }) {
  const head = `${label}${value}`;
  const gap = margin ? " ".repeat(Math.max(4, column - head.length)) : "";
  return `${head}${gap}${margin}${review ? `    ${review}` : ""}`;
}

// Replaces the token this field owns inside the clinician's own sentence. Returns null when the page
// cannot see a token it owns, which means the words are theirs and stay untouched.
function replaceToken(value, field, next) {
  if (field === "antibiotic" || field === "pain_medication") {
    const word = answerWord(next);
    if (BRACED.test(value)) return value.replace(BRACED, word);
    if (value.includes("***")) return value.replace("***", word);
    const match = value.match(ANSWER_TOKEN);
    if (match) return `${word}${value.slice(match[0].length)}`;
    return value.trim() === "" ? word : null;
  }
  if (field === "language") {
    const word = LANGUAGE_WORDS[next] ?? "English";
    if (BRACED.test(value)) return value.replace(BRACED, word);
    const spoken = value.split(/(\s+)/).findIndex((part) => LANGUAGE_NAMES.some(([pattern]) => pattern.test(part.replace(/[^\p{L}]/gu, ""))));
    if (spoken >= 0) {
      const parts = value.split(/(\s+)/);
      parts[spoken] = word;
      return parts.join("");
    }
    if (value.includes("***")) return value.replace("***", word);
    return value.trim() === "" ? `language ${word}` : null;
  }
  // follow_up_date: the date is a token inside the clinician's sentence about the visit.
  const found = findDate(value);
  const token = next ? usDate(next) : "***";
  if (found) return value.replace(found.text, token);
  if (value.includes("***")) return next ? value.replace("***", token) : value;
  if (!next) return value;
  return value.trim() === "" ? `wound check and ear exam on ${token}` : null;
}

export function writeFieldLine(text, field, value) {
  const lines = String(text ?? "").split(/\r?\n/);
  if (field === "reviewed") return { text: setReviewedLine(lines, value), outcome: "rewrote", kept: "", tail: "" };

  let outcome = null;
  let kept = "";
  let tail = "";
  // Every line for this field is rewritten, not just the first. Two lines that disagreed now agree, and
  // the duplicate is still the clinician's to delete: the page does not remove a line they typed.
  let first = true;
  const out = lines.map((raw) => {
    if (/^\s/.test(raw)) return raw;
    const key = keyOf(raw);
    if (!key || fieldFor(key) !== field) return raw;
    const parts = splitLine(raw);
    if (!parts) return raw;
    const written = replaceToken(parts.value, field, value);
    if (written === null) {
      if (first) {
        outcome = "kept";
        kept = parts.value.trim();
        first = false;
      }
      return raw;
    }
    if (first) {
      outcome = "rewrote";
      kept = "";
      first = false;
    }
    // Rewriting the answer can leave the clinician's own tail contradicting it: "No cephalexin 500 mg,
    // 7 days". The page keeps their words and tells them, rather than deleting the drug to look tidy.
    if ((field === "antibiotic" || field === "pain_medication") && !tail) {
      const tailText = written.replace(ANSWER_TOKEN, "").replace(/^[\s:;,.-]+/, "").trim();
      if (tailText) tail = tailText;
    }
    return joinLine({ ...parts, value: written });
  });

  if (!outcome) {
    const line = FIELD_LINES[field](value);
    if (!line) return { text: out.join("\n"), outcome: "rewrote", kept: "", tail: "" };
    // A new line goes above the signature, never below it.
    const signature = out.findIndex((raw) => /reviewed by/i.test(raw));
    const at = signature >= 0 ? signature : out.length;
    out.splice(at, 0, line);
    outcome = "added";
  }
  return { text: out.join("\n"), outcome, kept, tail };
}

function setReviewedLine(lines, value) {
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

export function setFieldLine(text, field, value) {
  return writeFieldLine(text, field, value).text;
}
