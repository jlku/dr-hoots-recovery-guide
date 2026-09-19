# AVS v2 Slice 5: Provider File and Medication Beats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A provider pastes the dot-phrase block from their own note and gets a patient link in under five seconds, with no account and no network call; the link switches segment 2's medication beats and shows the follow-up date.

**Architecture:** A pure parser in `guide/assets/provider.js` reads the block tolerantly, applies presets from `content/provider/presets.json`, and builds a link whose parameters live only in the URL fragment. A new canonical module `ci/medications` (status `surgeon_review`) supplies the two medication beats' wording from the UCSF EARS page. Segment 2's beats become conditional beats with sentences, and its media is pre-rendered per combination of present beats, so the player only picks a file.

**Tech Stack:** Vanilla ES modules, JSON, `node:test`, fal ElevenLabs v3 for three short tracks, `ffmpeg`.

**Spec:** `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md`, section 7 (Provider file, presets, and the dot-phrase draft), 11, 12, 13, 14.

## Global Constraints

- Lines are `Key: value`. A missing line means the preset. A present line overrides it. Reading is tolerant: `yes`, `y`, `no`, `n`, and Epic-style `{Yes/No}` remnants all parse; dates accept ISO and US formats and normalize to ISO; unknown lines are ignored and listed.
- Only these lines drive the guide: `Antibiotic`, `Pain medication`, `Follow-up`, `Video guide` language, and `Reviewed by`. The parser returns `{antibiotic, pain_medication, follow_up_date, language, reviewed}` plus a list of unread lines.
- Unreadable provider lines: list them, apply presets, never guess a yes or no.
- Presets ship as placeholders Song should confirm: antibiotic yes, pain medication yes, language English, follow-up date empty. An empty follow-up date renders the canonical "about two weeks" wording instead of a date.
- The follow-up date is a data field drawn as live text. It never passes through TTS.
- Medication wording is an evidence draft in canonical module `ci/medications` with `status: surgeon_review`.
- Antibiotic no and pain medication no have no source; those cases omit the beat, and the player shows a "pending clinician text" note in the status strip, never inside the reading flow.
- Variants are pre-rendered combinations of present beats, not free text.
- Patient link: `guide/index.html#a=1&p=0&f=2026-10-01&l=es&r=2026-09-17`. Parameters live in the fragment. No names, no record numbers.
- Provider pastes the block and gets a patient link in under 5 s, with no network calls. Nothing is stored server side.
- `patient_use: false` everywhere; spend under the $12 cap through the ledger.

## Sentences for `ci/medications`

From the UCSF EARS page (retrieved 2026-09-18), section "Days 2-7: Early Recovery": "Take antibiotics exactly as prescribed to prevent infection" and "Take pain medication as prescribed, staying ahead of pain rather than waiting until it's severe". The page's line that most people move to over-the-counter pain medicine after two to three days is left out on purpose: the draft dot phrase asks Song whether patients should avoid NSAIDs, so naming over-the-counter medicine could send someone to ibuprofen.

| ID | Sentence | Beat |
| --- | --- | --- |
| med.01 | Take your antibiotic the way it was prescribed. | antibiotic |
| med.02 | It helps prevent infection. | antibiotic |
| med.03 | Take your pain medicine the way it was prescribed. | pain medication |
| med.04 | Take it before the pain gets bad. | pain medication |

## File Structure

| File | Responsibility |
| --- | --- |
| `guide/assets/provider.js` | Pure parser, preset merge, and link builder, shared by the page and the tests |
| `content/provider/presets.json` | The placeholder presets |
| `guide/provider.html`, `guide/assets/provider-page.js` | The provider page |
| `content/canonical/ci-phase0-v0.1.0.json` | Gains the EARS source and the `ci/medications` module |
| `scripts/validate-canonical-content.mjs` | Allows `surgeon_review` and a later retrieval date per source |
| `content/segments/ci-phase0-v0.1.0.segments.json` | Medication beats with sentences and conditions |
| `scripts/lib/segments.mjs` | Conditional beats with sentences; variant helpers |
| `scripts/lib/segment-timeline.mjs`, `scripts/build-segment-media.mjs`, `scripts/validate-segments.mjs` | Media per variant |
| `guide/assets/logic.js`, `guide/assets/guide.js`, `guide/assets/data.js` | Variant choice, pending note, follow-up date |
| `content/translations/*` | The four sentences and the new labels in every pack |

---

### Task 1: The provider block parser, presets, and link

**Files:**
- Create: `guide/assets/provider.js`, `content/provider/presets.json`
- Test: `tests/v2-provider.test.mjs`

**Interfaces:**
- Produces: `parseProviderBlock(text) -> { fields: { antibiotic?, pain_medication?, follow_up_date?, language?, reviewed? }, unread: string[], other: number }`; `applyPresets(fields, presets) -> { values, from_presets: string[] }`; `buildPatientLink(values, base = "guide/index.html") -> string`; `normalizeDate(text) -> "YYYY-MM-DD" | null`; `parseYesNo(text) -> true | false | null`.

- [ ] **Step 1: Write the presets file**

```json
{
  "schema_version": "1.0",
  "status": "placeholder_for_song",
  "patient_use": false,
  "note": "Placeholders until Song confirms them. A missing line in the provider's block uses these.",
  "presets": { "antibiotic": true, "pain_medication": true, "language": "en", "follow_up_date": null }
}
```

- [ ] **Step 2: Write the failing tests**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { applyPresets, buildPatientLink, normalizeDate, parseProviderBlock, parseYesNo } from "../guide/assets/provider.js";

const root = resolve(import.meta.dirname, "..");
const presets = JSON.parse(await readFile(resolve(root, "content/provider/presets.json"), "utf8")).presets;

test("yes and no parse tolerantly, and an unchosen Epic list is never guessed", () => {
  for (const text of ["yes", "Y", "Yes: amoxicillin 500 mg for 7 days", "{Yes}", "yes."]) assert.equal(parseYesNo(text), true, text);
  for (const text of ["no", "N", "No: acetaminophen as needed", "{No}"]) assert.equal(parseYesNo(text), false, text);
  for (const text of ["{Yes/No}", "{Yes: *** name, dose, days / No}", "***", "", "maybe"]) assert.equal(parseYesNo(text), null, text);
});

test("dates accept ISO and US formats and normalize to ISO", () => {
  assert.equal(normalizeDate("2026-10-01"), "2026-10-01");
  assert.equal(normalizeDate("10/1/2026"), "2026-10-01");
  assert.equal(normalizeDate("wound check and ear exam on 10/01/26"), "2026-10-01");
  assert.equal(normalizeDate("***"), null);
  assert.equal(normalizeDate("13/40/2026"), null);
});

test("the block reads only its five driving lines, lists what it could not read, and applies presets", () => {
  const block = [
    ".CIPOSTOP  Cochlear implant post-operative instructions (UCSF OHNS)",
    "Surgery date: 9/15/2026          Side: Right          Surgeon: Dr. Example",
    "Antibiotic: No",
    "Pain medication: {Yes: *** / No: acetaminophen as needed}",
    "Follow-up: wound check and ear exam on 10/1/2026",
    "Video guide: language Spanish    Reviewed by Song on 9/17/2026"
  ].join("\n");
  const parsed = parseProviderBlock(block);
  assert.deepEqual(parsed.fields, { antibiotic: false, follow_up_date: "2026-10-01", language: "es", reviewed: { by: "Song", date: "2026-09-17" } });
  assert.deepEqual(parsed.unread, ["Pain medication: {Yes: *** / No: acetaminophen as needed}"]);
  assert.equal(parsed.other, 2);
  const merged = applyPresets(parsed.fields, presets);
  assert.equal(merged.values.pain_medication, true);
  assert.deepEqual(merged.from_presets, ["pain_medication"]);
  assert.equal(buildPatientLink(merged.values), "guide/index.html#a=0&p=1&f=2026-10-01&l=es&r=2026-09-17");
});

test("the link carries no names, and an empty block is all presets", () => {
  const merged = applyPresets(parseProviderBlock("").fields, presets);
  assert.deepEqual(merged.from_presets.sort(), ["antibiotic", "follow_up_date", "language", "pain_medication"]);
  assert.equal(buildPatientLink(merged.values), "guide/index.html#a=1&p=1&l=en");
  const named = buildPatientLink({ ...merged.values, reviewed: { by: "Song Lee", date: "2026-09-17" } });
  assert.ok(!named.includes("Song"), "the reviewer's name never enters the link");
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test tests/v2-provider.test.mjs`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 4: Implement `guide/assets/provider.js`**

```js
// guide/assets/provider.js
// Reads the provider's dot-phrase block: pure functions shared by the provider page and the tests.
// Only five lines drive the guide; every other line stays in the provider's note.

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
      fields.antibiotic = parseYesNo(value);
      readable = fields.antibiotic !== null;
      if (!readable) delete fields.antibiotic;
    } else if (key === "pain medication" || key === "pain medicine") {
      fields.pain_medication = parseYesNo(value);
      readable = fields.pain_medication !== null;
      if (!readable) delete fields.pain_medication;
    } else if (key === "follow up" || key === "followup") {
      const date = normalizeDate(value);
      readable = Boolean(date);
      if (date) fields.follow_up_date = date;
    } else if (key === "video guide") {
      const language = parseLanguage(value);
      readable = Boolean(language);
      if (language) fields.language = language;
    } else {
      driving = reviewedAt >= 0 && reviewedAt === 0;
    }
    if (reviewedAt >= 0) {
      const reviewed = parseReviewed(line.slice(reviewedAt));
      if (reviewed) fields.reviewed = reviewed;
      else if (!line.slice(reviewedAt).includes("***")) unread.push(line);
    }
    if (driving && !readable) unread.push(line);
    else if (!driving && reviewedAt < 0) other += 1;
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

export function buildPatientLink(values, base = "guide/index.html") {
  const params = new URLSearchParams();
  params.set("a", values.antibiotic ? "1" : "0");
  params.set("p", values.pain_medication ? "1" : "0");
  if (values.follow_up_date) params.set("f", values.follow_up_date);
  params.set("l", values.language ?? "en");
  if (values.reviewed?.date) params.set("r", values.reviewed.date);
  return `${base}#${params.toString()}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass, then commit**

Run: `node --test tests/v2-provider.test.mjs`
Expected: PASS. If a case fails, fix the parser, not the test: each case is a line from the spec's draft dot phrase.

```bash
git add guide/assets/provider.js content/provider/presets.json tests/v2-provider.test.mjs
git commit -m "feat: read the provider's dot-phrase block and build the patient link"
```

---

### Task 2: The provider page

**Files:**
- Create: `guide/provider.html`, `guide/assets/provider-page.js`
- Modify: `guide/assets/guide.css` (provider page rules)
- Test: `tests/v2-provider-structure.test.mjs`

**Interfaces:**
- Consumes: Task 1's `parseProviderBlock`, `applyPresets`, `buildPatientLink`.

- [ ] **Step 1: Write the failing structure test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const html = await readFile(resolve(root, "guide/provider.html"), "utf8");

test("the provider page has one block to paste, the parsed table, what it could not read, the link, and the asks for Song", () => {
  for (const id of ["block", "parsed", "unread", "patient-link", "copy-link", "asks"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /Private prototype\. Not for patient use\./);
  assert.match(html, /<textarea[^>]+id="block"/);
  assert.doesNotMatch(html, /<form[^>]+action=/, "nothing is sent anywhere");
  assert.doesNotMatch(html, /prompt|api[_-]?key|fal\.|anthropic/i, "no raw prompt fields or provider credentials");
});
```

- [ ] **Step 2: Run it to verify it fails, then write the page**

`guide/provider.html` holds the top bar and notice, a `<textarea id="block">` with a label, a table `id="parsed"` with columns Field, Value, and Source (`from your block` or `preset`), a list `id="unread"` headed "Lines we could not read", an output `id="patient-link"` with a `<button id="copy-link">`, and a list `id="asks"` with the six asks for Song from spec section 7. `guide/assets/provider-page.js` fetches `content/provider/presets.json` once, then on every `input` event parses the block, applies the presets, renders the table, the unread lines, and the link, with no other network call.

- [ ] **Step 3: Verify in the browser, run the tests, and commit**

Paste the spec's draft block with its `***` placeholders and check: the table shows presets for every field, the unread list names the unchosen lines, and the link is `guide/index.html#a=1&p=1&l=en`. Time from paste to link is under 5 s.

```bash
git add guide/provider.html guide/assets/provider-page.js guide/assets/guide.css tests/v2-provider-structure.test.mjs
git commit -m "feat: the provider page turns a pasted block into a patient link"
```

---

### Task 3: The `ci/medications` module

**Files:**
- Modify: `content/canonical/ci-phase0-v0.1.0.json`, `scripts/validate-canonical-content.mjs`
- Regenerate: media projections with `npm run media:build`
- Modify: `content/clinician/questions-for-song.md` (`q.medication-text`)

- [ ] **Step 1: Add the source and the module**

Source `ucsf-ears-ci-surgery-2026-09-18`, publisher `UCSF EARS program`, URL `https://ears.ucsf.edu/en/devices/ci-surgery-what-to-expect`, retrieved `2026-09-18`, passage location `Days 2-7: Early Recovery`, claims `ears.antibiotic.as_prescribed` ("Take antibiotics exactly as prescribed to prevent infection.") and `ears.pain.as_prescribed` ("Take pain medication as prescribed, staying ahead of pain rather than waiting until it is severe."), with `claim_snapshot_sha256` from `npm run content:hashes`.

Module `ci/medications`, version `0.1.0`, `status: "surgeon_review"`, phase `recovery days 0 to 14`, title `Your medicines`, the four sentences in the table above, `structured_values: []`, `unresolved_terms` listing "which over-the-counter pain medicine is allowed after the prescription" and "whether to avoid aspirin, ibuprofen, and other NSAIDs, and for how long", `visual_policy: "Text-only."`, and `review: { surgical_evaluator: "evidence_draft_2026-09-18", partner_surgeon: "required", patient_ready: false }`. Insert it after `ci/wound-care` in `canonical_order`.

- [ ] **Step 2: Let the validator accept the stricter status and a later retrieval date**

In `scripts/validate-canonical-content.mjs`:

```js
  assert(source.retrieved_at >= content.artifact.source_retrieved_at, `${source.id}: retrieved before the artifact's sources`);
```

```js
  assert(["unverified_draft", "surgeon_review"].includes(module.status), `${module.id}: status must be unverified_draft or surgeon_review`);
  if (module.status === "surgeon_review") assert(module.review.partner_surgeon === "required", `${module.id}: surgeon_review needs the partner surgeon marked required`);
```

- [ ] **Step 3: Regenerate and validate**

Run: `npm run content:hashes`, write the printed hashes and readability grade into the module and source, then `npm run media:build && npm run content:validate && npm run media:validate && npm run copy:validate`.
Expected: `Canonical content valid: 4 modules`, media projections valid with 31 sentence IDs.

- [ ] **Step 4: Commit**

```bash
git add content/canonical scripts/validate-canonical-content.mjs content/generated content/clinician/questions-for-song.md
git commit -m "feat: medication sentences as a surgeon-review module drafted from UCSF EARS"
```

---

### Task 4: Conditional beats with sentences, and media per variant

**Files:**
- Modify: `content/segments/ci-phase0-v0.1.0.segments.json`, `scripts/lib/segments.mjs`, `scripts/lib/segment-timeline.mjs`, `scripts/build-segment-media.mjs`, `scripts/validate-segments.mjs`, `content/frames/ci-phase0-v0.1.0.frames.json`
- Test: `tests/v2-segments.test.mjs`, `tests/v2-segment-timeline.test.mjs`

**Interfaces:**
- Produces: `CONDITION_PARAMS = { antibiotic: "a", pain_medication: "p" }`; `segmentVariants(segment) -> [{ id, conditions }]` where `id` is `""` for a segment without conditions and like `"a1p0"` otherwise; `buildSegmentTimeline({ …, conditions })` skips a conditional beat whose condition is false; media paths gain `.<variant>` before the extension; index entries gain `variant`.

- [ ] **Step 1: Give the medication beats their sentences**

```json
{ "id": "beat/medication-antibiotic", "condition": "antibiotic", "when_false": "pending_clinician_text", "sentence_ids": ["med.01", "med.02"], "frame": "frame-medication", "narration": {} },
{ "id": "beat/medication-pain", "condition": "pain_medication", "when_false": "pending_clinician_text", "sentence_ids": ["med.03", "med.04"], "frame": "frame-medication", "narration": {} }
```

`frame-medication` is a text frame. `frame-medication-pending` is removed.

- [ ] **Step 2: Write the failing tests**

```js
test("segment 2 has four variants, and a variant without a condition skips that beat", () => {
  const segment = bundle.segments.segments.find((item) => item.number === 2);
  assert.deepEqual(segmentVariants(segment).map((variant) => variant.id), ["a0p0", "a0p1", "a1p0", "a1p1"]);
  assert.deepEqual(segmentVariants(bundle.segments.segments[0]).map((variant) => variant.id), [""]);
});
```

- [ ] **Step 3: Implement variants**

In `scripts/lib/segments.mjs`:

```js
export const CONDITION_PARAMS = Object.freeze({ antibiotic: "a", pain_medication: "p" });

export function segmentVariants(segment) {
  const conditions = [...new Set(segment.beats.map((beat) => beat.condition).filter(Boolean))].sort((x, y) => CONDITION_PARAMS[x].localeCompare(CONDITION_PARAMS[y]));
  let variants = [{ id: "", conditions: {} }];
  for (const condition of conditions) {
    variants = variants.flatMap((variant) => [false, true].map((on) => ({ id: `${variant.id}${CONDITION_PARAMS[condition]}${on ? 1 : 0}`, conditions: { ...variant.conditions, [condition]: on } })));
  }
  return variants;
}
```

Coverage counts conditional beats' sentences. A conditional beat with sentences needs English narration like any beat.

In `buildSegmentTimeline`, accept `conditions = {}` and skip `beat.condition` when `conditions[beat.condition] !== true`. In `build-segment-media.mjs`, loop `segmentVariants(segment)` inside each language and write `…/next-two-weeks.a1p0.timeline.json` style paths, with `variant` in each index entry.

- [ ] **Step 4: Run, rebuild, and commit**

Run: `node --test tests/v2-segments.test.mjs tests/v2-segment-timeline.test.mjs && node scripts/build-segment-media.mjs --no-audio`
Expected: PASS. The medication beats still have no narration, so their variants fail the segment check until Task 5; commit after Task 5.

---

### Task 5: Medication narration in English, and in the chosen voices

- [ ] **Step 1: Add English to `assets/audio/v2/voices.json`**

```json
"en": { "language_code": "en", "voice": "George", "candidates": ["George"], "speed": 0.92, "stability": 0.68, "similarity_boost": 0.78, "seed_base": 93000 }
```

These are the settings of the existing English narration.

- [ ] **Step 2: Narrate only unbound beats**

Add `--unbound-only` to `scripts/generate-v2-narration.mjs`: plan only beats with no binding in that language, and bind only those. For English, `beatText` reads the canonical sentences through `resolveSentences`.

```bash
node --env-file=.env.local scripts/generate-v2-narration.mjs --language en --unbound-only
```

Expected: two English tracks, about $0.02. Spanish and Mandarin medication tracks come with their full narration in slice 4's Task 9.

- [ ] **Step 3: Build, check, and commit Tasks 4 and 5 together**

Run: `node scripts/build-segment-media.mjs && npm run check`
Expected: English segment 2 in four variants; every variant under 35 s.

```bash
git add content/segments content/frames assets/audio/v2 assets/captions/v2 scripts tests content/spend
git commit -m "feat: medication beats that play when the provider's block says yes, pre-rendered per combination"
```

---

### Task 6: The guide plays the right variant and shows the follow-up date

**Files:**
- Modify: `guide/assets/logic.js`, `guide/assets/guide.js`, `guide/assets/data.js`, `guide/assets/frames.js` (text frames), `content/translations/en/ci-phase0-v0.1.0.json`
- Test: `tests/v2-guide-logic.test.mjs`

**Interfaces:**
- Produces: `variantFor(params, presets) -> "a1p1"`; `pickEntry(index, number, language, variant = "")`; `statusMessages({ pack, fallback, labels, pendingConditions })`; `formatFollowUp(date, language) -> string`.

- [ ] **Step 1: Write the failing tests**

```js
test("the link's medication flags choose segment 2's variant, with presets for missing flags", () => {
  const presets = { antibiotic: true, pain_medication: true };
  assert.equal(variantFor({ a: "0", p: "1" }, presets), "a0p1");
  assert.equal(variantFor({}, presets), "a1p1");
  const index = { entries: [{ number: 2, language: "en", variant: "a0p1" }, { number: 2, language: "en", variant: "a1p1" }, { number: 1, language: "en", variant: "" }] };
  assert.equal(pickEntry(index, 2, "en", "a0p1").entry.variant, "a0p1");
  assert.equal(pickEntry(index, 1, "en", "a0p1").entry.variant, "", "a segment without variants ignores the flags");
});

test("a medication the provider said no to shows the pending note, and a follow-up date is written for the patient's language", () => {
  const labels = { "ui.pending_clinician_text": "Medication details are pending your surgeon's wording." };
  assert.deepEqual(statusMessages({ pack: { language: "en" }, fallback: false, labels, pendingConditions: ["antibiotic"] }), ["Medication details are pending your surgeon's wording."]);
  assert.equal(formatFollowUp("2026-10-01", "en"), "October 1, 2026");
  assert.equal(formatFollowUp("2026-10-01", "es"), "1 de octubre de 2026");
  assert.equal(formatFollowUp("2026-10-01", "zh-Hans"), "2026年10月1日");
});
```

- [ ] **Step 2: Implement**

```js
export function variantFor(params, presets) {
  const flag = (key, preset) => (params[key] === "1" ? "1" : params[key] === "0" ? "0" : preset ? "1" : "0");
  return `a${flag("a", presets.antibiotic)}p${flag("p", presets.pain_medication)}`;
}

export function formatFollowUp(date, language) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(language, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
```

`pickEntry` matches `variant` when the segment has variants and ignores it otherwise. `statusMessages` adds `labels["ui.pending_clinician_text"]` once when `pendingConditions` is not empty. `loadGuide` fetches the presets. The milestones text frame adds a line `labels["ui.follow_up_on"]` with `{date}` replaced by `formatFollowUp(params.f, language)` when the link carries `f`; add `"ui.follow_up_on": "Your wound check and ear exam: {date}"` to the English pack and translate it in both packs.

- [ ] **Step 3: Verify in the browser and commit**

Open `guide/index.html#s=2&a=0&p=1&f=2026-10-01&l=en`: segment 2 plays the pain beat and not the antibiotic beat, the status strip shows the pending note, and the milestones card shows the date.

```bash
git add guide/assets content/translations tests/v2-guide-logic.test.mjs
git commit -m "feat: the guide plays the provider's medication variant and shows the follow-up date"
```

---

### Task 7: Translate the medication sentences and review again

- [ ] **Step 1:** Add `med.01` to `med.04` and `ui.follow_up_on` to both packs, set `status` back to `machine_draft`, and validate.
- [ ] **Step 2:** Run slice 4's review loop (packet, fresh reviewer subagent, record, fix, repeat) for both languages until each pack has a passing receipt bound to its new hash; mark them `ai_reviewed`.
- [ ] **Step 3:** Commit: `git commit -m "feat: medication sentences in Spanish and Mandarin, reviewed"`.

---

### Task 8: Record the slice

- [ ] Update `docs/PROJECT_STATUS.md` with the provider page, the medication module's surgeon-review status, and the asks for Song, run `npm run check`, and commit.
