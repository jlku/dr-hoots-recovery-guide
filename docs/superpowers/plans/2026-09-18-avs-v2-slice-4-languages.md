# AVS v2 Slice 4: Spanish and Mandarin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Spanish (`es`) and Mandarin in Simplified Chinese (`zh-Hans`) to the one-page guide: translated packs, AI language reviews with receipts, narration, and captions, with English fallback when anything is missing.

**Architecture:** The guide already loads a language pack per language, picks media per language from `assets/captions/v2/index.json`, and falls back to English with a visible notice. This slice supplies the content (two translation records), a review loop that binds an AI reviewer's receipt to the exact pack it read, per-beat narration through the same fal ElevenLabs v3 model with the language code set, and the text handling Chinese needs: words that carry their own spacing, cues that record which words they hold, sentence ends and label wrapping that understand Chinese punctuation.

**Not in this slice:** one badge per reviewer on the contents page, read from `content/reviews/index.json`, arrives with the simulated Song review in slice 6. Here the guide shows the active translation's review label in its status strip.

**Tech Stack:** Vanilla ES modules, JSON, `node:test`, `Intl.Segmenter` (Node 22, full ICU), `@fal-ai/client` for narration, `ffmpeg` for segment audio, headless Chrome for renders.

**Spec:** `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md`, sections 6 (Languages), 8 (Reviewers and receipts), 10 (Spend), 11 (File layout), 12 (Data flow), 13 (Error handling), 14 (Testing).

## Global Constraints

- English canonical stays the single clinical source.
- Spanish (`es`) and Mandarin in Simplified Chinese script (`zh-Hans`) are translation records at `content/translations/<lang>/ci-phase0-v0.1.0.json`. Traditional Chinese script is a later addition, not part of this version.
- Translation `status` is one of `machine_draft`, `ai_reviewed`, `human_reviewed`.
- Validator: every canonical sentence ID present; every label key present; every protected value present in the translated sentence: phone numbers verbatim, numerals present with locale decimal separators allowed, the fever comparator preserved. Missing or altered protected values fail the build.
- Narration per language through the same ElevenLabs v3 model with the language code set. One short voice test per language before committing to a narrator.
- Subtitles per segment per language as WebVTT derived from character timestamps.
- The player falls back to English with a visible notice when a language asset is missing, never silently.
- Language reviewers check clinical equivalence sentence by sentence, protected values, register at grade 7 or below, and natural phrasing for Bay Area speakers. Receipt label: `AI reviewer (Claude), not a certified medical translator`. Everything AI-reviewed is labeled as AI in the UI.
- Hard ceiling 35 s of narration per segment, checked against the timestamp manifest, in every language.
- Spend cap $10. Every paid request logs to the ledger first and refuses to run past the cap.
- `patient_use: false` everywhere. AI review is never described as clinical approval.
- No framework. `npm run check` gains the new validators and tests; existing checks keep running.

## Budget

The ledger stands at $8.16. John raised the cap from $10 to $12 on 2026-09-18 for this version, so $3.84 remains. A live image review reserves $1.50, and one is kept for re-judging the bandage card after Song answers.

| Paid step | Estimate |
| --- | --- |
| Voice tests: two candidate voices per language, one short line each | $0.08 |
| Spanish narration, 11 beats | $0.25 |
| Mandarin narration, 11 beats | $0.11 |

After these, about $3.40 remains, enough for the card's re-review and one retry. Everything else in this slice costs nothing: translation drafts and language reviews run in session.

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/lib/language-packs.mjs` | Pack validation: every English label, protected digits in sentences and labels, protected phrases per language |
| `scripts/lib/narration-timing.mjs` | Tokenizing spoken text per language; word timings carry a `space` flag |
| `scripts/lib/segment-timeline.mjs` | Cues record `first_word` and `word_count`; Chinese cues break at Chinese punctuation and a character limit |
| `guide/assets/logic.js` | Cue word assignment from recorded ranges; sentence spans and word joining that honor `space` |
| `guide/assets/guide.js` | Transcript and captions join words by their `space` flag; the status strip shows the translation's review label |
| `guide/assets/frames.js` | `textWidth` and `wrapLines` that measure and wrap Chinese by character |
| `guide/assets/guide.css` | Font stack with Chinese fallbacks |
| `content/translations/es/…`, `content/translations/zh-Hans/…` | The two translation records |
| `reviewers/es/`, `reviewers/zh/` | Persona and rubric per language reviewer |
| `scripts/lib/translation-review.mjs` | Pack content hash, review packets, receipt validation |
| `scripts/review-packet.mjs`, `scripts/review-record.mjs` | Emit a packet; validate and store a receipt |
| `content/reviews/es/`, `content/reviews/zh/` | Receipts, named by the pack hash they bind to |
| `scripts/lib/v2-narration.mjs` | Beat text per language, narration plan, records, translated-narration validation |
| `scripts/generate-v2-narration.mjs` | Voice tests and per-beat narration through fal, gated by the ledger |
| `assets/audio/v2/voices.json` | The chosen voice per language |
| `assets/audio/v2/<lang>/beats/*.mp3`, `assets/audio/v2/<lang>/narration.json` | Per-beat narration and its manifest |
| `tests/v2-*.test.mjs` | Tests per task below |

---

### Task 1: Pack validation covers every label and protects the fever threshold

**Files:**
- Modify: `scripts/lib/language-packs.mjs`
- Modify: `scripts/validate-translations.mjs`
- Test: `tests/v2-language-packs.test.mjs`

**Interfaces:**
- Produces: `PROTECTED_PHRASES` (object keyed by language, then by sentence id or label key, value is an array of alternatives lists); `validateLanguagePack({ pack, canonical, segments, source })` where `source` is the English pack and is optional for the English pack itself.

- [ ] **Step 1: Write the failing tests**

Update `spanishFixture()` so its fever sentence and label are Spanish, then add three tests:

```js
function spanishFixture() {
  const sentences = Object.fromEntries([...canonicalSentenceText(bundle.canonical)].map(([id, text]) => [id, `ES ${text}`]));
  sentences["call.02"] = "Llame si tiene fiebre de más de 101.5 grados Fahrenheit.";
  const labels = Object.fromEntries(Object.keys(englishPack.labels).map((key) => [key, `ES ${englishPack.labels[key]}`]));
  labels["ov.fever"] = "Fiebre de más de 101.5 °F";
  return {
    schema_version: "1.0",
    language: "es",
    script: "Latn",
    artifact_id: "ci-phase0",
    artifact_version: "0.1.0",
    status: "machine_draft",
    patient_use: false,
    sentences,
    labels,
    review: { kind: "none", label: "Borrador de traducción automática, aún sin revisar", date: "2026-09-18", receipt: null }
  };
}
const check = (pack) => validateLanguagePack({ pack, canonical: bundle.canonical, segments: bundle.segments, source: englishPack }).errors.join("\n");

test("every English label is required, including the labels drawn in the pictures, and no others", () => {
  const pack = spanishFixture();
  assert.equal(check(pack), "");
  delete pack.labels["ov.tape_check"];
  pack.labels["ov.invented"] = "x";
  pack.labels["ov.keep_dry"] = "Mantenga seco hasta tres días después";
  const errors = check(pack);
  assert.match(errors, /missing label ov\.tape_check/);
  assert.match(errors, /unknown label ov\.invented/);
  assert.match(errors, /label ov\.keep_dry lost protected value 3/);
});

test("the fever threshold keeps its direction and its unit in every language", () => {
  const noComparator = spanishFixture();
  noComparator.sentences["call.02"] = "Llame si tiene fiebre de 101.5 grados Fahrenheit.";
  assert.match(check(noComparator), /sentence call\.02 must keep one of: más de/);
  const noUnit = spanishFixture();
  noUnit.labels["ov.fever"] = "Fiebre de más de 101.5";
  assert.match(check(noUnit), /label ov\.fever must keep one of: °F, Fahrenheit/);
  const chinese = { ...spanishFixture(), language: "zh-Hans", script: "Hans" };
  chinese.sentences = { ...chinese.sentences, "call.02": "如果发烧超过华氏101.5度，请打电话。" };
  chinese.labels = { ...chinese.labels, "ov.fever": "发烧超过 101.5 °F" };
  assert.equal(check(chinese), "");
  chinese.sentences["call.02"] = "如果发烧华氏101.5度，请打电话。";
  assert.match(check(chinese), /sentence call\.02 must keep one of: 超过, 高于/);
});

test("a language without protected phrases cannot be added", () => {
  const french = { ...spanishFixture(), language: "fr" };
  assert.match(check(french), /no protected phrases are defined for fr/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/v2-language-packs.test.mjs`
Expected: FAIL on `unknown label`, `lost protected value 3`, `must keep one of`, and `no protected phrases`.

- [ ] **Step 3: Implement**

In `scripts/lib/language-packs.mjs`, add after `TRANSLATION_STATUSES`:

```js
// Words that keep the fever threshold's direction and unit, per language. English is the source, so
// it has none. A new language cannot pass validation until its alternatives are listed here.
const OVER = { es: ["más de", "por encima de", "superior a", "mayor de", "mayor que"], "zh-Hans": ["超过", "高于"] };
const FAHRENHEIT = { es: ["Fahrenheit", "°F"], "zh-Hans": ["华氏", "°F"] };
export const PROTECTED_PHRASES = Object.freeze({
  es: { "call.02": [OVER.es, FAHRENHEIT.es], "ov.fever": [OVER.es, ["°F", "Fahrenheit"]] },
  "zh-Hans": { "call.02": [OVER["zh-Hans"], FAHRENHEIT["zh-Hans"]], "ov.fever": [OVER["zh-Hans"], ["°F", "华氏"]] }
});
```

Replace `validateLanguagePack` with:

```js
export function validateLanguagePack({ pack, canonical, segments, source = null }) {
  const errors = [];
  if (typeof pack?.language !== "string" || !pack.language) errors.push("language is required");
  if (pack?.artifact_id !== canonical.artifact.id || pack?.artifact_version !== canonical.artifact.version) {
    errors.push("pack must reference the canonical artifact id and version");
  }
  const labels = pack?.labels ?? {};
  const sourceLabels = source?.labels ?? {};
  const required = [...new Set([...requiredLabelKeys(segments), ...Object.keys(sourceLabels)])];
  for (const key of required) {
    if (typeof labels[key] !== "string" || !labels[key].trim()) errors.push(`missing label ${key}`);
  }
  if (pack?.language === "en") {
    if (pack.sentences_source !== "canonical") errors.push("the English pack must declare sentences_source canonical");
    if (pack.sentences) errors.push("the English pack must not copy canonical sentences");
    return { valid: errors.length === 0, errors };
  }
  if (source) {
    for (const key of Object.keys(labels)) if (!(key in sourceLabels)) errors.push(`unknown label ${key}`);
    for (const [key, english] of Object.entries(sourceLabels)) {
      if (typeof labels[key] !== "string") continue;
      const actual = digitTokens(labels[key]);
      for (const token of digitTokens(english)) if (!actual.includes(token)) errors.push(`label ${key} lost protected value ${token}`);
    }
  }
  const canonicalText = canonicalSentenceText(canonical);
  const sentences = pack?.sentences ?? {};
  for (const id of canonicalSentenceOrder(canonical)) {
    const text = sentences[id];
    if (typeof text !== "string" || !text.trim()) {
      errors.push(`missing sentence ${id}`);
      continue;
    }
    const actual = digitTokens(text);
    for (const token of digitTokens(canonicalText.get(id))) {
      if (!actual.includes(token)) errors.push(`sentence ${id} lost protected value ${token}`);
    }
  }
  for (const id of Object.keys(sentences)) {
    if (!canonicalText.has(id)) errors.push(`unknown sentence ${id}`);
  }
  const phrases = PROTECTED_PHRASES[pack?.language];
  if (!phrases) errors.push(`no protected phrases are defined for ${pack?.language}; add them to PROTECTED_PHRASES first`);
  for (const [id, groups] of Object.entries(phrases ?? {})) {
    const isSentence = canonicalText.has(id);
    const text = (isSentence ? sentences[id] : labels[id]) ?? "";
    for (const alternatives of groups) {
      if (!alternatives.some((phrase) => text.includes(phrase))) errors.push(`${isSentence ? "sentence" : "label"} ${id} must keep one of: ${alternatives.join(", ")}`);
    }
  }
  if (!TRANSLATION_STATUSES.includes(pack?.status)) errors.push(`status must be one of ${TRANSLATION_STATUSES.join(", ")}`);
  if (!pack?.review?.label) errors.push("review.label is required so the UI can show who reviewed the translation");
  return { valid: errors.length === 0, errors };
}
```

In `scripts/validate-translations.mjs`, load the English pack first and pass it as `source` for every pack:

```js
  const english = packs.find((entry) => entry.pack.language === "en")?.pack;
  if (!english) {
    console.error("error: the English pack content/translations/en is required");
    process.exit(1);
  }
  let failed = false;
  for (const { language, path, pack } of packs) {
    const errors = [...validateLanguagePack({ pack, canonical: bundle.canonical, segments: bundle.segments, source: english }).errors];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/v2-language-packs.test.mjs && node scripts/validate-translations.mjs`
Expected: all tests PASS; `content/translations/en/ci-phase0-v0.1.0.json: valid (en, source)`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/language-packs.mjs scripts/validate-translations.mjs tests/v2-language-packs.test.mjs
git commit -m "feat: translated packs need every label and keep the fever threshold's direction"
```

---

### Task 2: Words carry their own spacing, so Chinese captions work

**Files:**
- Modify: `scripts/lib/narration-timing.mjs`
- Modify: `scripts/lib/segment-timeline.mjs`
- Modify: `guide/assets/logic.js`
- Modify: `guide/assets/guide.js:201-203` and `guide/assets/guide.js:230-232`
- Regenerate: `assets/captions/v2/en/*.timeline.json` with `node scripts/build-segment-media.mjs --no-audio`
- Test: `tests/v2-narration-timing.test.mjs`, `tests/v2-segment-timeline.test.mjs`, `tests/v2-guide-logic.test.mjs`

**Interfaces:**
- Produces: `isSpacelessLanguage(language) -> boolean`; `tokenize(text, language) -> [{ text, index, space }]`; `wordTimings(record, language = "en") -> [{ text, charStart, start, end, space }]`; `joinWords(words) -> string` (exported from both `segment-timeline.mjs` and `logic.js`; a word without `space` counts as spaced); cues gain `first_word` and `word_count`; timeline words gain `space`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/v2-narration-timing.test.mjs`:

```js
import { isSpacelessLanguage, tokenize, wordTimings } from "../scripts/lib/narration-timing.mjs";

const timed = (text) => ({ id: "t", text, timestamps: [{ characters: [...text], character_start_times_seconds: [...text].map((_, i) => i * 0.1), character_end_times_seconds: [...text].map((_, i) => i * 0.1 + 0.09) }] });

test("spaced languages split on whitespace and remember the space after each word", () => {
  assert.equal(isSpacelessLanguage("es"), false);
  assert.deepEqual(tokenize("Hola, ¿cómo está?", "es").map(({ text, space }) => [text, space]), [["Hola,", true], ["¿cómo", true], ["está?", false]]);
});

test("Chinese splits into words, keeps punctuation on the word before it, and has no spaces", () => {
  assert.equal(isSpacelessLanguage("zh-Hans"), true);
  const tokens = tokenize("两天后，取下头部绷带。", "zh-Hans");
  assert.equal(tokens.map((token) => token.text).join(""), "两天后，取下头部绷带。");
  assert.ok(tokens.every((token) => token.space === false));
  assert.ok(tokens.some((token) => token.text.endsWith("，")), "the comma stays on the word before it");
  assert.ok(!tokens.some((token) => /^[，。]/.test(token.text)), "no token starts with punctuation");
  const words = wordTimings(timed("两天后，取下头部绷带。"), "zh-Hans");
  assert.equal(words[0].start, 0);
  assert.equal(words.at(-1).end, 1.09);
});
```

Append to `tests/v2-segment-timeline.test.mjs`:

```js
import { groupCues, joinWords } from "../scripts/lib/segment-timeline.mjs";

test("cues record which words they hold, and Chinese cues join without spaces and break at Chinese punctuation", () => {
  const words = ["两天后，", "取下", "头部", "绷带。", "接下来", "检查"].map((text, index) => ({ text, start: index, end: index + 0.9, space: false }));
  const cues = groupCues(words, "beat/a", 8, 0, { maxChars: 16, firstWord: 10 });
  assert.deepEqual(cues.map((cue) => cue.text), ["两天后，", "取下头部绷带。", "接下来检查"]);
  assert.deepEqual(cues.map((cue) => [cue.first_word, cue.word_count]), [[10, 1], [11, 3], [14, 2]]);
  assert.equal(joinWords([{ text: "Hola,", space: true }, { text: "mundo.", space: false }]), "Hola, mundo.");
  assert.equal(joinWords([{ text: "old" }, { text: "timeline" }]), "old timeline", "a word without a space flag counts as spaced");
});
```

Append to `tests/v2-guide-logic.test.mjs`:

```js
import { assignWordsToCues, joinWords as joinGuideWords, sentenceSpans } from "../guide/assets/logic.js";

test("the guide takes each cue's words from its recorded range and ends Chinese sentences at 。", () => {
  const words = [
    { text: "两天后，", start: 1, end: 1.5, beat: "b", space: false },
    { text: "取下绷带。", start: 1.5, end: 2.5, beat: "b", space: false },
    { text: "然后检查。", start: 2.6, end: 3.5, beat: "b", space: false }
  ];
  const timeline = { words, cues: [{ id: "cue-01", text: "两天后，", first_word: 0, word_count: 1 }, { id: "cue-02", text: "取下绷带。然后检查。", first_word: 1, word_count: 2 }] };
  assert.deepEqual(assignWordsToCues(timeline).get("cue-02").map((word) => word.text), ["取下绷带。", "然后检查。"]);
  const sentences = sentenceSpans(timeline);
  assert.deepEqual(sentences.map((sentence) => sentence.text), ["两天后，取下绷带。", "然后检查。"]);
  assert.equal(joinGuideWords([{ text: "a", space: true }, { text: "b" }]), "a b");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/v2-narration-timing.test.mjs tests/v2-segment-timeline.test.mjs tests/v2-guide-logic.test.mjs`
Expected: FAIL with `isSpacelessLanguage` / `joinWords` not exported.

- [ ] **Step 3: Implement the tokenizer**

In `scripts/lib/narration-timing.mjs`, replace `wordTimings` with:

```js
// Languages written without spaces between words. Their words come from the ICU segmenter.
export function isSpacelessLanguage(language) {
  return /^(zh|ja)(-|$)/.test(language ?? "");
}

// Tokens of the spoken text with their character offsets and whether a space follows. Spaced
// languages split on whitespace. Chinese is split into words, and punctuation stays on the word
// before it so no caption line starts with a comma.
export function tokenize(text, language = "en") {
  if (!isSpacelessLanguage(language)) {
    return [...text.matchAll(/\S+/g)].map((match) => ({ text: match[0], index: match.index, space: /\s/.test(text[match.index + match[0].length] ?? "") }));
  }
  const tokens = [];
  for (const part of new Intl.Segmenter(language, { granularity: "word" }).segment(text)) {
    if (/^\s+$/.test(part.segment)) {
      if (tokens.length) tokens.at(-1).space = true;
      continue;
    }
    const previous = tokens.at(-1);
    if (!part.isWordLike && previous && !previous.space) {
      previous.text += part.segment;
      continue;
    }
    tokens.push({ text: part.segment, index: part.index, space: false });
  }
  if (tokens.length) tokens.at(-1).space = false;
  return tokens;
}

export function wordTimings(record, language = "en") {
  const characters = flattenRecordCharacters(record);
  return tokenize(record.text, language).map((token) => {
    const last = token.index + token.text.length - 1;
    return { text: token.text, charStart: token.index, start: characters[token.index].start, end: characters[last].end, space: token.space };
  });
}
```

- [ ] **Step 4: Implement cues with word ranges**

In `scripts/lib/segment-timeline.mjs`:

```js
import { isSpacelessLanguage, speechEndSeconds, wordTimings } from "./narration-timing.mjs";

const CUE_BREAK = /[.;:!?…。；：！？，]$|—$/;

export function joinWords(words) {
  return words.map((word, index) => word.text + ((word.space ?? true) && index < words.length - 1 ? " " : "")).join("");
}

export function groupCues(beatWords, beatId, maxWordsPerCue, startIndex, { maxChars = Infinity, firstWord = 0 } = {}) {
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
    if (current.length >= maxWordsPerCue || joinWords(current).length >= maxChars || CUE_BREAK.test(word.text)) flush();
  }
  flush();
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].start < cues[index - 1].end) cues[index].start = cues[index - 1].end;
  }
  return cues;
}
```

In `buildSegmentTimeline`, pass the language to `wordTimings`, carry `space` on each word, and hand `groupCues` the running word index:

```js
    const beatWords = wordTimings(record, language).map((word) => ({
      text: word.text,
      start: round(start + word.start),
      end: round(start + word.end),
      beat: beat.id,
      space: word.space
    }));
    const firstWord = words.length;
    words.push(...beatWords);
    cues.push(...groupCues(beatWords, beat.id, maxWordsPerCue, cues.length, { maxChars: isSpacelessLanguage(language) ? 16 : Infinity, firstWord }));
```

- [ ] **Step 5: Teach the guide the same rules**

In `guide/assets/logic.js`:

```js
export function joinWords(words) {
  return words.map((word, index) => word.text + ((word.space ?? true) && index < words.length - 1 ? " " : "")).join("");
}

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

const SENTENCE_END = /[.?!。？！]["')\]”’」』）]*$/;
```

and in `sentenceSpans`, set `current.text = joinWords(current.words);`.

In `guide/assets/guide.js`, the transcript and the caption add a space only where the word has one:

```js
        if (index < sentence.words.length - 1 && (word.space ?? true)) button.append(document.createTextNode(" "));
```

```js
    if (index < words.length - 1 && (word.space ?? true)) dom.caption.append(document.createTextNode(" "));
```

- [ ] **Step 6: Rebuild the English timelines and run everything**

Run: `node scripts/build-segment-media.mjs --no-audio && npm run check`
Expected: English VTT files are unchanged; timelines gain `space`, `first_word`, and `word_count`; `segments valid … committed media is current`; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/narration-timing.mjs scripts/lib/segment-timeline.mjs guide/assets/logic.js guide/assets/guide.js assets/captions/v2 tests/v2-narration-timing.test.mjs tests/v2-segment-timeline.test.mjs tests/v2-guide-logic.test.mjs
git commit -m "feat: words carry their own spacing, so captions work in Chinese"
```

---

### Task 3: Picture labels measure and wrap Chinese

**Files:**
- Modify: `guide/assets/frames.js` (the `FONT` constant, `wrapLines`, the panel label width, the pointer width)
- Modify: `guide/assets/guide.css` (`--sans`)
- Modify: `guide/frame.html` (a `lang` parameter, so a frame can be rendered in any pack's language)
- Test: `tests/v2-frames.test.mjs`

**Interfaces:**
- Produces: `textWidth(text, size) -> number` and `wrapLines(text, size, maxWidth) -> string[]`, both exported from `guide/assets/frames.js`.

- [ ] **Step 1: Write the failing test**

```js
import { textWidth, wrapLines } from "../guide/assets/frames.js";

test("labels measure Chinese at one em per character and wrap it between characters", () => {
  assert.equal(textWidth("发烧", 30), 60);
  assert.equal(Math.round(textWidth("ab", 30)), 31);
  const lines = wrapLines("头痛、怕光或异常嗜睡，请打电话", 30, 200);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => textWidth(line, 30) <= 200), lines.join(" | "));
  assert.equal(lines.join(""), "头痛、怕光或异常嗜睡，请打电话");
  assert.ok(!lines.slice(1).some((line) => /^[，。、；：！？）]/.test(line)), "no line starts with punctuation");
  assert.deepEqual(wrapLines("Red and swollen", 30, 1000), ["Red and swollen"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v2-frames.test.mjs`
Expected: FAIL with `textWidth` not exported.

- [ ] **Step 3: Implement**

In `guide/assets/frames.js`:

```js
const FONT = "'Helvetica Neue', Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif";
// Chinese characters and full-width punctuation are about one em wide; Latin letters about half.
const WIDE = /[⺀-鿿豈-﫿＀-￯　-〿]/u;
const CLOSING = /^[，。、；：！？）」』”’]/u;

export function textWidth(text, size) {
  let width = 0;
  for (const character of text) width += WIDE.test(character) ? size : size * 0.52;
  return width;
}

export function wrapLines(text, size, maxWidth) {
  // Spaced text wraps between words. Chinese wraps between characters, keeps runs of Latin letters
  // and digits together, and never starts a line with closing punctuation.
  const spaced = !WIDE.test(text);
  const units = spaced ? text.split(" ") : text.match(/[A-Za-z0-9.,°%+-]+|\s+|./gu) ?? [];
  const joiner = spaced ? " " : "";
  const lines = [];
  let line = "";
  for (const unit of units) {
    if (!spaced && /^\s+$/.test(unit) && !line) continue;
    const next = line ? `${line}${joiner}${unit}` : unit;
    if (textWidth(next, size) > maxWidth && line && !CLOSING.test(unit)) {
      lines.push(line);
      line = unit.trim();
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}
```

In `renderPanels`, measure the label pill with `textWidth`:

```js
      const width = Math.min(VIEW.w - 80, textWidth(text, size) * 1.12 + size * 1.28);
```

In the `pointer` overlay:

```js
    const width = Math.min(480, Math.max(220, textWidth(text, size) * 1.06));
```

In `guide/frame.html`, load the requested language and pick that language's timeline when it exists:

```js
  import { pickEntry } from "./assets/logic.js";
  const guide = await loadGuide(params.get("lang") ?? "en");
  // …after finding the segment and beat…
  const entry = pickEntry(guide.index, found.segment.number, guide.language).entry;
```

In `guide/assets/guide.css`:

```css
  --sans: "Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif;
```

- [ ] **Step 4: Run the tests and confirm the English card is unchanged**

Run: `node --test tests/v2-frames.test.mjs`, then render `frame-01` with headless Chrome and compare it byte for byte with `assets/anatomy/diagrams/remove-dressing.png`:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,768 --virtual-time-budget=8000 --screenshot=/tmp/card-check.png "http://localhost:4178/guide/frame.html?frame=frame-01"
cmp /tmp/card-check.png assets/anatomy/diagrams/remove-dressing.png && echo "card unchanged"
```

Expected: PASS and `card unchanged`, because the reviewed card's receipt is bound to its hash. If the bytes differ, revert the width change for Latin text rather than re-review.

- [ ] **Step 5: Commit**

```bash
git add guide/assets/frames.js guide/assets/guide.css tests/v2-frames.test.mjs
git commit -m "feat: picture labels measure and wrap Chinese by character"
```

---

### Task 4: Spanish and Mandarin packs, as machine drafts

**Files:**
- Create: `content/translations/es/ci-phase0-v0.1.0.json`
- Create: `content/translations/zh-Hans/ci-phase0-v0.1.0.json`

**Interfaces:**
- Consumes: Task 1's validator.
- Produces: two packs with `status: "machine_draft"`, 27 `sentences`, the same 59 `labels` keys as English, and `review.kind: "none"`.

- [ ] **Step 1: Write each pack with this skeleton**

```json
{
  "schema_version": "1.0",
  "language": "es",
  "script": "Latn",
  "artifact_id": "ci-phase0",
  "artifact_version": "0.1.0",
  "status": "machine_draft",
  "patient_use": false,
  "notice": "SIN VERIFICAR — NO PARA USO CON PACIENTES",
  "sentences": {},
  "labels": {},
  "review": { "kind": "none", "label": "Borrador de traducción automática, aún sin revisar", "date": "2026-09-18", "receipt": null }
}
```

For Mandarin: `"language": "zh-Hans"`, `"script": "Hans"`, notice `未经核实——不得用于患者`, review label `机器翻译草稿，尚未审核`.

Translation rules, applied to every one of the 27 canonical sentences and 59 labels:
- Translate the canonical meaning sentence by sentence. Never add, drop, or soften an instruction, a time, a threshold, or a condition. The English narration's wording is not the source; `content/canonical/ci-phase0-v0.1.0.json` is.
- Plain words at grade 7 or below. Spanish uses `usted`. Mandarin uses Simplified characters and everyday Mainland vocabulary that Bay Area speakers share.
- Numbers stay digits exactly as in English: `415-353-2148`, `415-476-1000`, `101.5`, `12`, and the digits in labels such as `Day 2` and `3 days`. The fever sentence keeps a comparator from `PROTECTED_PHRASES` and names Fahrenheit.
- Keep `UCSF`. Name the specialty as `Otorrinolaringología` and `耳鼻喉科`.
- Picture labels stay short enough to fit where the English fits.

- [ ] **Step 2: Validate**

Run: `node scripts/validate-translations.mjs`
Expected: three lines ending `valid (en, source)`, `valid (es, machine_draft)`, `valid (zh-Hans, machine_draft)`.

- [ ] **Step 3: Render every labeled frame in both languages and look at them**

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for lang in es zh-Hans; do for frame in frame-01 frame-0203-paths frame-06-redness frame-0710-anylist frame-13-programming; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,768 --virtual-time-budget=8000 --screenshot="$SCRATCH/renders/$lang-$frame.png" "http://localhost:4178/guide/frame.html?frame=$frame&lang=$lang"
done; done
```

Expected: every label is in the pack's language, fits inside its picture, and no Chinese line starts with punctuation. Shorten any label that does not fit, and validate again.

- [ ] **Step 4: Commit**

```bash
git add content/translations/es content/translations/zh-Hans
git commit -m "feat: Spanish and Mandarin packs as machine drafts"
```

---

### Task 5: Language reviewers that bind a receipt to the exact pack they read

**Files:**
- Create: `reviewers/es/persona.md`, `reviewers/es/rubric.json`, `reviewers/zh/persona.md`, `reviewers/zh/rubric.json`
- Create: `scripts/lib/translation-review.mjs`, `scripts/review-packet.mjs`, `scripts/review-record.mjs`
- Modify: `scripts/validate-translations.mjs` (an `ai_reviewed` pack needs a passing receipt bound to its current hash)
- Modify: `scripts/lib/adjudication.mjs` (`validateReviews` also validates `content/reviews/es` and `content/reviews/zh`)
- Test: `tests/v2-translation-review.test.mjs`

**Interfaces:**
- Produces:
  - `TRANSLATION_REVIEWERS` = `{ es: { language: "es", dir: "content/reviews/es" }, zh: { language: "zh-Hans", dir: "content/reviews/zh" } }` and `REVIEWER_LABEL` = `"AI reviewer (Claude), not a certified medical translator"`.
  - `packContentHash(pack) -> string`: sha256 of `JSON.stringify({ language, script, sentences, labels })` with keys sorted, so status and review edits do not change it.
  - `buildPacket({ root, reviewer }) -> { reviewer, target: { file, language, sha256 }, rubric: { id, sha256, criteria }, items: [{ id, kind, source, translation }] }`.
  - `validateReceipt(receipt, packet) -> string[]` (errors).
  - `receiptPath(reviewer, sha256) -> "content/reviews/<reviewer>/<first 16 hex>.json"`.

- [ ] **Step 1: Write the rubric and persona files**

`reviewers/es/rubric.json`:

```json
{
  "id": "es-translation-v1",
  "language": "es",
  "criteria": [
    { "id": "equivalence", "question": "Does the Spanish say exactly what the English says: the same action, time, threshold, condition, and who does it, with nothing added or dropped?" },
    { "id": "protected_values", "question": "Are phone numbers, numerals, and the fever comparator and unit intact?" },
    { "id": "register", "question": "Is it at grade 7 or below, in usted, with everyday words a patient would use?" },
    { "id": "phrasing", "question": "Would a Spanish speaker in the Bay Area find it natural and unambiguous?" }
  ],
  "verdict_rule": "An item passes only when every criterion passes. The receipt passes only when every item passes."
}
```

`reviewers/zh/rubric.json` is the same shape with `"id": "zh-translation-v1"`, `"language": "zh-Hans"`, and the questions naming Simplified Chinese and Mandarin speakers in the Bay Area.

`reviewers/es/persona.md` (the zh persona mirrors it):

```markdown
# Spanish language reviewer (AI)

You are a bilingual medical translator reviewing a patient guide for adults recovering from cochlear implant surgery at UCSF. You are an AI reviewer (Claude), not a certified medical translator, and every receipt says so.

You receive a packet: the English source and the Spanish translation for every sentence and label, and a rubric. Judge each item against every rubric criterion. Be strict about meaning: a softened instruction, a changed time, a lost condition, or a number that differs is a failure even when the Spanish reads well. Do not rewrite the English. When an item fails, say what is wrong and give a corrected Spanish text.

Answer with only the receipt JSON described in the packet's `receipt_format`.
```

- [ ] **Step 2: Write the failing tests**

`tests/v2-translation-review.test.mjs`:

```js
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { REVIEWER_LABEL, buildPacket, packContentHash, receiptPath, validateReceipt } from "../scripts/lib/translation-review.mjs";

const root = resolve(import.meta.dirname, "..");

function passingReceipt(packet) {
  return {
    schema_version: "1.0",
    reviewer: packet.reviewer,
    kind: "ai",
    label: REVIEWER_LABEL,
    model: "claude-opus-5 (session subagent)",
    reviewed_on: "2026-09-18",
    target: packet.target,
    rubric: { id: packet.rubric.id, sha256: packet.rubric.sha256 },
    items: packet.items.map((item) => ({ id: item.id, kind: item.kind, verdict: "pass", criteria: Object.fromEntries(packet.rubric.criteria.map((criterion) => [criterion.id, "pass"])), note: "" })),
    findings: [],
    verdict: "pass"
  };
}

test("a packet lists every sentence and label with the pack's content hash", async () => {
  const packet = await buildPacket({ root, reviewer: "es" });
  assert.equal(packet.target.language, "es");
  assert.equal(packet.items.filter((item) => item.kind === "sentence").length, 27);
  assert.ok(packet.items.some((item) => item.id === "ov.fever" && item.kind === "label"));
  assert.match(packet.target.sha256, /^[0-9a-f]{64}$/);
  assert.equal(receiptPath("es", packet.target.sha256), `content/reviews/es/${packet.target.sha256.slice(0, 16)}.json`);
});

test("the content hash ignores status and review, so recording a review does not unbind it", () => {
  const pack = { language: "es", script: "Latn", sentences: { a: "x" }, labels: { b: "y" }, status: "machine_draft", review: {} };
  assert.equal(packContentHash(pack), packContentHash({ ...pack, status: "ai_reviewed", review: { receipt: "r" } }));
  assert.notEqual(packContentHash(pack), packContentHash({ ...pack, sentences: { a: "z" } }));
});

test("a receipt must bind to the pack, cover every item on every criterion, carry the AI label, and verdict by the rule", async () => {
  const packet = await buildPacket({ root, reviewer: "es" });
  assert.deepEqual(validateReceipt(passingReceipt(packet), packet), []);
  const wrongHash = { ...passingReceipt(packet), target: { ...packet.target, sha256: "0".repeat(64) } };
  assert.match(validateReceipt(wrongHash, packet).join("\n"), /does not bind to the current pack/);
  const unlabeled = { ...passingReceipt(packet), label: "Approved" };
  assert.match(validateReceipt(unlabeled, packet).join("\n"), /label must be/);
  const missing = passingReceipt(packet);
  missing.items = missing.items.filter((item) => item.id !== "wc.03");
  assert.match(validateReceipt(missing, packet).join("\n"), /does not review wc\.03/);
  const inconsistent = passingReceipt(packet);
  inconsistent.items[0].criteria.equivalence = "fail";
  assert.match(validateReceipt(inconsistent, packet).join("\n"), /item wc\.01 fails a criterion but is marked pass/);
  inconsistent.items[0].verdict = "fail";
  assert.match(validateReceipt(inconsistent, packet).join("\n"), /receipt verdict must be fail/);
  inconsistent.verdict = "fail";
  assert.match(validateReceipt(inconsistent, packet).join("\n"), /failing item wc\.01 needs a finding/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/v2-translation-review.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/translation-review.mjs'`.

- [ ] **Step 4: Implement `scripts/lib/translation-review.mjs`**

```js
// scripts/lib/translation-review.mjs
// AI language review of a translation pack: the packet a reviewer reads, and the rules its receipt
// must meet. A receipt binds to the pack's content hash, so any edit to a sentence or label needs a
// new review.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalSentenceText } from "./language-packs.mjs";
import { canonicalSentenceOrder } from "./segments.mjs";

export const REVIEWER_LABEL = "AI reviewer (Claude), not a certified medical translator";
export const TRANSLATION_REVIEWERS = Object.freeze({
  es: { language: "es", dir: "content/reviews/es" },
  zh: { language: "zh-Hans", dir: "content/reviews/zh" }
});
const ARTIFACT = "ci-phase0-v0.1.0";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const sorted = (object) => Object.fromEntries(Object.keys(object ?? {}).sort().map((key) => [key, object[key]]));

export function packContentHash(pack) {
  return sha256(JSON.stringify({ language: pack.language, script: pack.script, sentences: sorted(pack.sentences), labels: sorted(pack.labels) }));
}

export function receiptPath(reviewer, hash) {
  return `${TRANSLATION_REVIEWERS[reviewer].dir}/${hash.slice(0, 16)}.json`;
}

export async function buildPacket({ root, reviewer }) {
  const config = TRANSLATION_REVIEWERS[reviewer];
  if (!config) throw new Error(`unknown reviewer ${reviewer}; use one of ${Object.keys(TRANSLATION_REVIEWERS).join(", ")}`);
  const file = `content/translations/${config.language}/${ARTIFACT}.json`;
  const [packText, englishText, canonicalText, rubricText, persona] = await Promise.all([
    readFile(join(root, file), "utf8"),
    readFile(join(root, `content/translations/en/${ARTIFACT}.json`), "utf8"),
    readFile(join(root, `content/canonical/${ARTIFACT}.json`), "utf8"),
    readFile(join(root, `reviewers/${reviewer}/rubric.json`), "utf8"),
    readFile(join(root, `reviewers/${reviewer}/persona.md`), "utf8")
  ]);
  const pack = JSON.parse(packText);
  const english = JSON.parse(englishText);
  const canonical = JSON.parse(canonicalText);
  const rubric = JSON.parse(rubricText);
  const source = canonicalSentenceText(canonical);
  const items = [
    ...canonicalSentenceOrder(canonical).map((id) => ({ id, kind: "sentence", source: source.get(id), translation: pack.sentences?.[id] ?? null })),
    ...Object.keys(english.labels).map((id) => ({ id, kind: "label", source: english.labels[id], translation: pack.labels?.[id] ?? null }))
  ];
  return {
    reviewer,
    persona,
    target: { file, language: pack.language, sha256: packContentHash(pack) },
    rubric: { id: rubric.id, sha256: sha256(rubricText), criteria: rubric.criteria, verdict_rule: rubric.verdict_rule },
    items,
    receipt_format: {
      schema_version: "1.0", reviewer, kind: "ai", label: REVIEWER_LABEL, model: "<the model you are>", reviewed_on: "<YYYY-MM-DD>",
      target: "<copy the packet's target>", rubric: "<copy the packet's rubric id and sha256>",
      items: "[{ id, kind, verdict: pass|fail, criteria: { <criterion id>: pass|fail }, note }] for every packet item, in order",
      findings: "[{ id, criterion, problem, suggestion }] for every failing criterion", verdict: "pass only when every item passes"
    }
  };
}

export function validateReceipt(receipt, packet) {
  const errors = [];
  if (receipt?.reviewer !== packet.reviewer) errors.push(`receipt reviewer must be ${packet.reviewer}`);
  if (receipt?.kind !== "ai") errors.push("receipt kind must be ai");
  if (receipt?.label !== REVIEWER_LABEL) errors.push(`receipt label must be "${REVIEWER_LABEL}"`);
  if (!receipt?.model) errors.push("receipt needs the reviewing model");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receipt?.reviewed_on ?? "")) errors.push("receipt needs reviewed_on as YYYY-MM-DD");
  if (receipt?.target?.sha256 !== packet.target.sha256 || receipt?.target?.file !== packet.target.file) errors.push("receipt does not bind to the current pack; review the pack again");
  if (receipt?.rubric?.id !== packet.rubric.id || receipt?.rubric?.sha256 !== packet.rubric.sha256) errors.push("receipt does not use the current rubric");
  const criteria = packet.rubric.criteria.map((criterion) => criterion.id);
  const byId = new Map((receipt?.items ?? []).map((item) => [item.id, item]));
  if (byId.size !== (receipt?.items ?? []).length) errors.push("receipt reviews an item twice");
  const failing = [];
  for (const expected of packet.items) {
    const item = byId.get(expected.id);
    if (!item) {
      errors.push(`receipt does not review ${expected.id}`);
      continue;
    }
    for (const criterion of criteria) {
      if (!["pass", "fail"].includes(item.criteria?.[criterion])) errors.push(`item ${expected.id} needs ${criterion}: pass or fail`);
    }
    const allPass = criteria.every((criterion) => item.criteria?.[criterion] === "pass");
    if (item.verdict === "pass" && !allPass) errors.push(`item ${expected.id} fails a criterion but is marked pass`);
    if (item.verdict === "fail") failing.push(expected.id);
  }
  for (const id of byId.keys()) if (!packet.items.some((item) => item.id === id)) errors.push(`receipt reviews unknown item ${id}`);
  const expectedVerdict = failing.length || errors.some((error) => /fails a criterion/.test(error)) ? "fail" : "pass";
  if (receipt?.verdict !== expectedVerdict) errors.push(`receipt verdict must be ${expectedVerdict}`);
  for (const id of failing) {
    if (!(receipt?.findings ?? []).some((finding) => finding.id === id)) errors.push(`failing item ${id} needs a finding`);
  }
  return errors;
}
```

- [ ] **Step 5: Write the two command-line scripts**

`scripts/review-packet.mjs`:

```js
// Emits the packet a language reviewer reads: node scripts/review-packet.mjs es [--out packet.json]
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPacket } from "./lib/translation-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [reviewer] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const outIndex = process.argv.indexOf("--out");
const packet = await buildPacket({ root, reviewer });
const text = `${JSON.stringify(packet, null, 2)}\n`;
if (outIndex > 0) await writeFile(process.argv[outIndex + 1], text);
else process.stdout.write(text);
```

`scripts/review-record.mjs`:

```js
// Validates a language reviewer's receipt against the current pack and stores it, immutably, under
// content/reviews/<reviewer>/: node scripts/review-record.mjs receipt.json
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPacket, receiptPath, validateReceipt } from "./lib/translation-review.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const receipt = JSON.parse(await readFile(process.argv[2], "utf8"));
const packet = await buildPacket({ root, reviewer: receipt.reviewer });
const errors = validateReceipt(receipt, packet);
if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}
const path = receiptPath(receipt.reviewer, receipt.target.sha256);
const exists = await access(join(root, path)).then(() => true, () => false);
if (exists) {
  console.error(`error: ${path} already holds the receipt for this pack; receipts are never replaced`);
  process.exit(1);
}
await mkdir(dirname(join(root, path)), { recursive: true });
await writeFile(join(root, path), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`${path}: ${receipt.verdict}`);
```

- [ ] **Step 6: Tie receipts into the existing validators**

In `scripts/validate-translations.mjs`, import `readFile` and `join`, and `TRANSLATION_REVIEWERS`, `buildPacket`, and `validateReceipt` from `./lib/translation-review.mjs`. After the pack errors, for a pack whose `status` is `ai_reviewed`:

```js
    if (pack.status === "ai_reviewed") {
      const reviewer = Object.entries(TRANSLATION_REVIEWERS).find(([, config]) => config.language === pack.language)?.[0];
      try {
        const receipt = JSON.parse(await readFile(join(repositoryRoot, pack.review?.receipt ?? ""), "utf8"));
        const packet = await buildPacket({ root: repositoryRoot, reviewer });
        errors.push(...validateReceipt(receipt, packet).map((error) => `review: ${error}`));
        if (receipt.verdict !== "pass") errors.push("review: an ai_reviewed pack needs a passing receipt");
      } catch (error) {
        errors.push(`review: ${pack.review?.receipt ?? "no receipt"} cannot be read (${error.message})`);
      }
    }
```

In `scripts/lib/adjudication.mjs`, import `REVIEWER_LABEL`, `TRANSLATION_REVIEWERS`, and `receiptPath` from `./translation-review.mjs`, and add to `validateReviews` before it returns. Older receipts for earlier hashes stay valid history; only the pack's own `review.receipt` must bind to the current hash, which Task 5's translation check enforces.

```js
  let translationReceipts = 0;
  for (const [reviewer, config] of Object.entries(TRANSLATION_REVIEWERS)) {
    const names = await readdir(join(root, config.dir)).then((list) => list.filter((name) => name.endsWith(".json")), () => []);
    for (const name of names) {
      const file = `${config.dir}/${name}`;
      const receipt = JSON.parse(await readFile(join(root, file), "utf8"));
      translationReceipts += 1;
      if (file !== receiptPath(reviewer, receipt.target?.sha256 ?? "")) errors.push(`${file} is not named by the pack hash it binds to`);
      if (receipt.label !== REVIEWER_LABEL) errors.push(`${file} must carry the label "${REVIEWER_LABEL}"`);
      const allPass = (receipt.items ?? []).length > 0 && receipt.items.every((item) => item.verdict === "pass");
      if ((receipt.verdict === "pass") !== allPass) errors.push(`${file} verdict does not follow from its items`);
    }
  }
```

Report `translationReceipts` in the summary line of `scripts/validate-reviews.mjs`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/v2-translation-review.test.mjs && npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add reviewers/es reviewers/zh scripts/lib/translation-review.mjs scripts/review-packet.mjs scripts/review-record.mjs scripts/validate-translations.mjs scripts/lib/adjudication.mjs tests/v2-translation-review.test.mjs
git commit -m "feat: language reviewers whose receipts bind to the exact pack they read"
```

---

### Task 6: Run the language reviews and mark the packs reviewed

> **Revised during execution (2026-09-18): three reviewers per pack version.** One reviewer run does not report every problem it could find. The Spanish round-one reviewer passed `ui.pending_clinician_text` and round two failed it; the first Mandarin panel failed `act.02`, which two single rounds had passed. So a pack now counts as reviewed only when `PANEL_SIZE` (3) independent reviewers, dispatched in parallel on the same packet and none seeing another's receipt, each pass it. `review-record.mjs` files receipts into slots `<hash16>.json`, `<hash16>.2.json`, `<hash16>.3.json`; the pack's review block lists all three under `receipts`; `validate-translations.mjs` requires the full panel to pass. After a failing panel, fix every finding and sweep the pack for the same kind of problem before the next panel.

**Files:**
- Create: `content/reviews/es/<hash>.json`, `content/reviews/zh/<hash>.json`
- Modify: both packs (`status`, `review`), and their sentences or labels when a reviewer finds a problem

- [ ] **Step 1: Build each packet**

```bash
node scripts/review-packet.mjs es --out "$SCRATCH/packet-es.json"
node scripts/review-packet.mjs zh --out "$SCRATCH/packet-zh.json"
```

- [ ] **Step 2: Dispatch one reviewer subagent per language**

Give each subagent only its persona, and tell it to read its packet file and answer with the receipt JSON. It must not read anything else in the repository. Save its answer to `$SCRATCH/receipt-<reviewer>-r1.json`.

- [ ] **Step 3: Record the receipt**

Run: `node scripts/review-record.mjs "$SCRATCH/receipt-es-r1.json"`
Expected: `content/reviews/es/<hash>.json: pass` or `: fail`. A failing receipt is still recorded: it is the evidence for the fix.

- [ ] **Step 4: Fix what failed and review again**

Apply each finding's suggestion to the pack only where it keeps the canonical meaning. Rebuild the packet, which now has a new hash, and dispatch a fresh subagent. Stop after three rounds per language and report what still fails.

- [ ] **Step 5: Mark the pack reviewed**

For a passing receipt, set the pack's `status` to `ai_reviewed` and its review block to the localized label, for example:

```json
"review": { "kind": "ai", "label": "Revisado por IA (Claude), no por un traductor médico certificado", "date": "2026-09-18", "receipt": "content/reviews/es/<hash>.json" }
```

Mandarin label: `经人工智能（Claude）审核，并非认证医学翻译`.

- [ ] **Step 6: Validate and commit**

Run: `npm run check`
Expected: `valid (es, ai_reviewed)` and `valid (zh-Hans, ai_reviewed)`.

```bash
git add content/translations content/reviews
git commit -m "feat: AI-reviewed Spanish and Mandarin packs, with receipts"
```

---

### Task 7: A narration generator for the translated packs

**Files:**
- Create: `scripts/lib/v2-narration.mjs`, `scripts/generate-v2-narration.mjs`, `assets/audio/v2/voices.json`
- Modify: `scripts/lib/segments.mjs` (`validateSegments` checks every narrated language), `scripts/validate-segments.mjs` (prints seconds per language and checks translated narration against its pack)
- Test: `tests/v2-narration-generation.test.mjs`

**Interfaces:**
- Produces:
  - `NARRATION_MODEL` = `"fal-ai/elevenlabs/tts/eleven-v3"`.
  - `narratedBeats(segments) -> beat[]` (skips conditional beats).
  - `beatText(beat, pack) -> string`: the beat's sentences from the pack, joined with a space, or with nothing in a spaceless language.
  - `beatRecordId(beat) -> string`: `beat.id` with `beat/` removed.
  - `narrationManifestPath(language) -> "assets/audio/v2/<language>/narration.json"`.
  - `planNarration({ segments, pack, voice, manifest }) -> [{ beat_id, record_id, text, sentence_ids, estimate_usd, keep }]`.
  - `validateTranslatedNarration({ segments, records, packs }) -> string[]`.

- [ ] **Step 1: Write the voices file with the candidates**

`assets/audio/v2/voices.json`:

```json
{
  "schema_version": "1.0",
  "note": "The English narration uses George at speed 0.92. Each translated language keeps the voice John picks from the voice test.",
  "languages": {
    "es": { "language_code": "es", "voice": null, "candidates": ["George", "Aria"], "speed": 1.0, "stability": 0.68, "similarity_boost": 0.78, "seed_base": 91000 },
    "zh-Hans": { "language_code": "zh", "voice": null, "candidates": ["George", "Aria"], "speed": 1.0, "stability": 0.68, "similarity_boost": 0.78, "seed_base": 92000 }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/v2-narration-generation.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { beatRecordId, beatText, narratedBeats, planNarration, validateTranslatedNarration } from "../scripts/lib/v2-narration.mjs";
import { loadSegmentBundle } from "../scripts/lib/segments.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const pack = (language, join) => ({ language, sentences: Object.fromEntries(bundle.segments.segments.flatMap((s) => s.beats).flatMap((b) => b.sentence_ids).map((id) => [id, `${language}:${id}${join}`])) });

test("a beat's narration is its sentences from the pack, spaced in Spanish and unspaced in Chinese", () => {
  const beat = narratedBeats(bundle.segments)[0];
  assert.equal(beatRecordId(beat), beat.id.replace(/^beat\//, ""));
  assert.equal(beatText(beat, pack("es", ".")), beat.sentence_ids.map((id) => `es:${id}.`).join(" "));
  assert.equal(beatText(beat, pack("zh-Hans", "。")), beat.sentence_ids.map((id) => `zh-Hans:${id}。`).join(""));
});

test("the plan prices each beat, and keeps a beat whose recorded text and voice are unchanged", () => {
  const es = pack("es", ".");
  const voice = { voice: "George", language_code: "es" };
  const first = planNarration({ segments: bundle.segments, pack: es, voice, manifest: { records: [] } });
  assert.equal(first.length, narratedBeats(bundle.segments).length);
  assert.ok(first.every((item) => item.estimate_usd > 0 && !item.keep));
  const manifest = { records: [{ id: first[0].record_id, text: first[0].text, voice: "George", language_code: "es" }] };
  const second = planNarration({ segments: bundle.segments, pack: es, voice, manifest });
  assert.equal(second[0].keep, true);
  assert.equal(second[1].keep, false);
});

test("translated narration must say exactly the pack's sentences, for every narrated beat", () => {
  const segments = structuredClone(bundle.segments);
  const beat = narratedBeats(segments)[0];
  beat.narration.es = { manifest: "m.json", record_id: beatRecordId(beat) };
  const records = new Map([[`m.json#${beatRecordId(beat)}`, { id: beatRecordId(beat), text: "wrong", canonicalSentenceIds: beat.sentence_ids }]]);
  const errors = validateTranslatedNarration({ segments, records, packs: [pack("es", ".")] }).join("\n");
  assert.match(errors, new RegExp(`${beat.id} es narration does not say the pack's sentences`));
  assert.match(errors, /es narration is missing for beat\//, "a language is complete or absent");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/v2-narration-generation.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/v2-narration.mjs'`.

- [ ] **Step 4: Implement `scripts/lib/v2-narration.mjs`**

```js
// scripts/lib/v2-narration.mjs
// Narration for the translated packs: one track per beat, spoken from the pack's sentences through
// the same ElevenLabs v3 model as English, with the language code set.
import { isSpacelessLanguage } from "./narration-timing.mjs";
import { resolveRecord } from "./segments.mjs";
import { estimateNarrationUsd } from "./spend-ledger.mjs";

export const NARRATION_MODEL = "fal-ai/elevenlabs/tts/eleven-v3";

export function narratedBeats(segments) {
  return segments.segments.flatMap((segment) => segment.beats).filter((beat) => typeof beat.condition !== "string" && beat.sentence_ids.length);
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

export function validateTranslatedNarration({ segments, records, packs }) {
  const errors = [];
  const beats = narratedBeats(segments);
  const languages = new Set(beats.flatMap((beat) => Object.keys(beat.narration ?? {})).filter((language) => language !== "en"));
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
```

- [ ] **Step 5: Generalize the segment checks to every narrated language**

In `scripts/lib/segments.mjs` `validateSegments`, after the English checks, check every other language that any beat binds: the record exists, its timestamps are well formed (`speechEndSeconds` does not throw), its `canonicalSentenceIds` match the beat, and each segment's narration in that language is at most `NARRATION_CEILING_SECONDS`:

```js
  const languages = new Set((segments.segments ?? []).flatMap((segment) => segment.beats ?? []).flatMap((beat) => Object.keys(beat.narration ?? {})));
  languages.delete("en");
  for (const language of languages) {
    for (const segment of segments.segments ?? []) {
      for (const beat of segment.beats ?? []) {
        const binding = beat.narration?.[language];
        if (!binding) continue;
        const record = resolveRecord(records, binding);
        if (!record) {
          errors.push(`${beat.id} references missing ${language} narration record ${binding.record_id}`);
          continue;
        }
        try {
          speechEndSeconds(record);
        } catch (error) {
          errors.push(`${beat.id} ${language}: ${error.message}`);
        }
        if (Array.isArray(record.canonicalSentenceIds) && !sameSet(record.canonicalSentenceIds, beat.sentence_ids)) {
          errors.push(`${beat.id} ${language} narration covers ${record.canonicalSentenceIds.join(",")} but the beat declares ${beat.sentence_ids.join(",")}`);
        }
      }
      try {
        const seconds = segmentNarrationSeconds(segment, records, language);
        if (seconds > NARRATION_CEILING_SECONDS) errors.push(`${segment.id} ${language} narration is ${seconds}s, over the ${NARRATION_CEILING_SECONDS}s ceiling`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }
```

Move `loadLanguagePacks` from `scripts/validate-translations.mjs` into `scripts/lib/language-packs.mjs` (with its `readdir`, `readFile`, and `join` imports) and import it from there in both scripts, because importing a script would run its command-line code.

In `scripts/validate-segments.mjs`:

```js
import { loadLanguagePacks } from "./lib/language-packs.mjs";
import { validateTranslatedNarration } from "./lib/v2-narration.mjs";
// in main(), after validateSegments:
  const packs = (await loadLanguagePacks(repositoryRoot)).map((entry) => entry.pack);
  errors.push(...validateTranslatedNarration({ segments: bundle.segments, records: bundle.records, packs }));
  const languages = [...new Set(bundle.segments.segments.flatMap((segment) => segment.beats).flatMap((beat) => Object.keys(beat.narration ?? {})))].sort();
  for (const segment of bundle.segments.segments) {
    const seconds = languages.map((language) => {
      try {
        return `${language} ${segmentNarrationSeconds(segment, bundle.records, language).toFixed(1)}s`;
      } catch {
        return `${language} unbound`;
      }
    });
    console.log(`${String(segment.number).padStart(2, "0")}  ${segment.id.padEnd(26)} ${seconds.join("  ")}`);
  }
```

This replaces the English-only seconds loop.

- [ ] **Step 6: Write `scripts/generate-v2-narration.mjs`**

```js
// Narration for a translated pack, one track per beat, through fal's ElevenLabs v3 with the language
// code set. Every request reserves its estimate in the ledger first.
//   node --env-file=.env.local scripts/generate-v2-narration.mjs --language es [--dry-run] [--force]
//   node --env-file=.env.local scripts/generate-v2-narration.mjs --language es --voice-test --out <dir>
import { fal } from "@fal-ai/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSegmentBundle } from "./lib/segments.mjs";
import { loadLedger, reserveSpend, saveLedger, settleSpend, estimateNarrationUsd } from "./lib/spend-ledger.mjs";
import { NARRATION_MODEL, narratedBeats, narrationManifestPath, planNarration } from "./lib/v2-narration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const language = arg("--language");
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const voiceTest = process.argv.includes("--voice-test");
const voices = JSON.parse(await readFile(join(root, "assets/audio/v2/voices.json"), "utf8")).languages;
const settings = voices[language];
if (!settings) throw new Error(`--language must be one of ${Object.keys(voices).join(", ")}`);
const pack = JSON.parse(await readFile(join(root, `content/translations/${language}/ci-phase0-v0.1.0.json`), "utf8"));
const bundle = await loadSegmentBundle(root);

async function speak({ text, voice, seed, ledgerId, purpose }) {
  await saveLedger(root, reserveSpend(await loadLedger(root), { id: ledgerId, model: NARRATION_MODEL, purpose, units: { characters: text.length, language, voice }, estimate_usd: estimateNarrationUsd(text.length) }));
  let result;
  try {
    result = await fal.subscribe(NARRATION_MODEL, {
      input: { text, voice, stability: settings.stability, similarity_boost: settings.similarity_boost, speed: settings.speed, language_code: settings.language_code, apply_text_normalization: "auto", timestamps: true, seed, output_format: "mp3_44100_128" }
    });
  } catch (error) {
    await saveLedger(root, settleSpend(await loadLedger(root), ledgerId, { status: "failed" }));
    throw error;
  }
  // Billed once fal answers, so the entry settles before the download that could still fail.
  await saveLedger(root, settleSpend(await loadLedger(root), ledgerId, { status: "completed", requestId: result.requestId ?? null }));
  const response = await fetch(result.data.audio.url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), requestId: result.requestId ?? null, timestamps: result.data.timestamps ?? [] };
}

if (!dryRun && !process.env.FAL_KEY) throw new Error("FAL_KEY is missing; run with --env-file=.env.local");
if (!dryRun) fal.config({ credentials: process.env.FAL_KEY });
const stamp = new Date().toISOString();

if (voiceTest) {
  // One short line per candidate voice, the sentence with a phone number, so a listener hears numbers too.
  const out = arg("--out");
  const text = pack.sentences["call.06"];
  for (const [index, voice] of settings.candidates.entries()) {
    console.log(`${language} ${voice}: ${text.length} characters, about $${estimateNarrationUsd(text.length).toFixed(2)}`);
    if (dryRun) continue;
    const { bytes } = await speak({ text, voice, seed: settings.seed_base + 900 + index, ledgerId: `tts:${language}:voice-test:${voice}:${stamp}`, purpose: `voice test for ${language}: ${voice}` });
    await mkdir(out, { recursive: true });
    await writeFile(join(out, `voice-test-${language}-${voice}.mp3`), bytes);
  }
  process.exit(0);
}

if (!settings.voice) throw new Error(`pick a voice for ${language} in assets/audio/v2/voices.json after the voice test`);
const manifestPath = narrationManifestPath(language);
const manifest = JSON.parse(await readFile(join(root, manifestPath), "utf8").catch(() => '{"records":[]}'));
const plan = planNarration({ segments: bundle.segments, pack, voice: settings, manifest });
const todo = plan.filter((item) => force || !item.keep);
console.log(`${language}: ${todo.length} of ${plan.length} beats to narrate, about $${todo.reduce((sum, item) => sum + item.estimate_usd, 0).toFixed(2)}`);
if (dryRun) process.exit(0);
let records = manifest.records ?? [];
for (const [index, item] of plan.entries()) {
  if (!force && item.keep) continue;
  const seed = settings.seed_base + index;
  const { bytes, requestId, timestamps } = await speak({ text: item.text, voice: settings.voice, seed, ledgerId: `tts:${language}:${item.record_id}:${stamp}`, purpose: `${language} narration for ${item.beat_id}` });
  const file = `assets/audio/v2/${language}/beats/${item.record_id}.mp3`;
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), bytes);
  records = [...records.filter((record) => record.id !== item.record_id), {
    id: item.record_id, file, text: item.text, language, language_code: settings.language_code, canonicalSentenceIds: item.sentence_ids,
    model: NARRATION_MODEL, voice: settings.voice, stability: settings.stability, similarityBoost: settings.similarity_boost, speed: settings.speed,
    outputFormat: "mp3_44100_128", seed, requestId, timestamps, status: "draft_preview_only"
  }];
  await mkdir(dirname(join(root, manifestPath)), { recursive: true });
  await writeFile(join(root, manifestPath), `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`);
  console.log(`${item.record_id}: saved`);
}
// Bind every narrated beat to its record, so the language is complete or absent.
const segmentsPath = join(root, "content/segments/ci-phase0-v0.1.0.segments.json");
const segments = JSON.parse(await readFile(segmentsPath, "utf8"));
for (const beat of narratedBeats(segments)) beat.narration[language] = { manifest: manifestPath, record_id: beat.id.replace(/^beat\//, "") };
await writeFile(segmentsPath, `${JSON.stringify(segments, null, 2)}\n`);
console.log(`bound ${language} narration on every beat`);
```

- [ ] **Step 7: Run the tests, then a dry run**

Run: `node --test tests/v2-narration-generation.test.mjs && npm run check && node scripts/generate-v2-narration.mjs --language es --voice-test --dry-run`
Expected: PASS; the dry run prints each candidate voice with its character count and cost and makes no request.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/v2-narration.mjs scripts/generate-v2-narration.mjs assets/audio/v2/voices.json scripts/lib/segments.mjs scripts/validate-segments.mjs tests/v2-narration-generation.test.mjs
git commit -m "feat: narration for translated packs, one track per beat, gated by the ledger"
```

---

### Task 8: Voice tests, then John picks a narrator per language

**Files:**
- Modify: `content/spend/v2-ledger.json` (four entries)
- Modify later: `assets/audio/v2/voices.json` (`voice` per language)

- [ ] **Step 1: Generate the samples**

```bash
node --env-file=/Users/johnkuo/Documents/ChatGPT/avs-video/.env.local scripts/generate-v2-narration.mjs --language es --voice-test --out "$SCRATCH/voice-tests"
node --env-file=/Users/johnkuo/Documents/ChatGPT/avs-video/.env.local scripts/generate-v2-narration.mjs --language zh-Hans --voice-test --out "$SCRATCH/voice-tests"
```

Expected: four MP3 files and four completed ledger entries, about $0.08 in total.

- [ ] **Step 2: Send the samples to John and stop**

Send the four files. Ask which voice sounds native in each language. This is a listening judgment only a person can make. Do not narrate the full guide until John answers.

- [ ] **Step 3: Record the choice and commit**

Set `voice` for each language in `assets/audio/v2/voices.json`.

```bash
git add assets/audio/v2/voices.json content/spend/v2-ledger.json
git commit -m "chore: voice tests for Spanish and Mandarin, and the chosen narrators"
```

---

### Task 9: Narrate both languages and build their captions

**Files:**
- Create: `assets/audio/v2/es/…`, `assets/audio/v2/zh-Hans/…`, `assets/captions/v2/es/…`, `assets/captions/v2/zh-Hans/…`
- Modify: `content/segments/ci-phase0-v0.1.0.segments.json` (bindings), `assets/captions/v2/index.json`, `content/spend/v2-ledger.json`

- [ ] **Step 1: Dry run, then narrate**

```bash
node scripts/generate-v2-narration.mjs --language es --dry-run
node --env-file=/Users/johnkuo/Documents/ChatGPT/avs-video/.env.local scripts/generate-v2-narration.mjs --language es
node --env-file=/Users/johnkuo/Documents/ChatGPT/avs-video/.env.local scripts/generate-v2-narration.mjs --language zh-Hans
```

Expected: 11 beats per language, bound on every beat.

- [ ] **Step 2: Build the segment media**

Run: `node scripts/build-segment-media.mjs && node scripts/validate-segments.mjs --media`
Expected: timelines, VTT, and audio for `es` and `zh-Hans`; each segment at or under 35 s in every language.

If a Spanish segment is over 35 s, first shorten wording that the review marked as wordy, then re-review the pack (Task 6) and regenerate only the changed beats. Raising `speed` to at most 1.1 is the second option. Never cut a proposition.

- [ ] **Step 3: Commit**

```bash
git add assets/audio/v2 assets/captions/v2 content/segments content/spend
git commit -m "feat: Spanish and Mandarin narration and captions for all five segments"
```

---

### Task 10: The guide shows who reviewed the translation, and works in both languages

**Files:**
- Modify: `guide/assets/logic.js` (`statusMessages`), `guide/assets/guide.js` (use it)
- Test: `tests/v2-guide-logic.test.mjs`

**Interfaces:**
- Produces: `statusMessages({ pack, fallback, labels }) -> string[]`.

- [ ] **Step 1: Write the failing test**

```js
import { statusMessages } from "../guide/assets/logic.js";

test("a translated guide always says who reviewed the translation, and says when it fell back to English", () => {
  const labels = { "ui.language_fallback": "This language is not available yet. Showing English." };
  assert.deepEqual(statusMessages({ pack: { language: "en", review: { label: "English source text" } }, fallback: false, labels }), []);
  assert.deepEqual(statusMessages({ pack: { language: "es", review: { label: "Revisado por IA (Claude), no por un traductor médico certificado" } }, fallback: false, labels }), ["Revisado por IA (Claude), no por un traductor médico certificado"]);
  assert.deepEqual(statusMessages({ pack: { language: "en", review: {} }, fallback: true, labels }), ["This language is not available yet. Showing English."]);
});
```

- [ ] **Step 2: Run it to verify it fails, then implement**

```js
export function statusMessages({ pack, fallback, labels }) {
  const messages = [];
  if (fallback) messages.push(labels["ui.language_fallback"]);
  if (pack?.language !== "en" && pack?.review?.label) messages.push(pack.review.label);
  return messages.filter(Boolean);
}
```

In `guide/assets/guide.js`, add `statusMessages` to the import from `./logic.js`, and replace `setStatus([fallback ? text["ui.language_fallback"] : null]);` with `setStatus(statusMessages({ pack: guide.pack, fallback, labels: text }));`.

- [ ] **Step 3: Verify in the browser**

Serve the worktree (`slice3-node` in `.claude/launch.json`, port 4178) and check `guide/index.html#s=1&l=es` and `#s=1&l=zh-Hans` at 1280 by 800 and in 375 by 812 phone emulation:
- The language selector offers both languages, and the page, captions, transcript, and picture labels are in that language.
- Chinese captions highlight word by word with no stray spaces, and the transcript breaks at 。.
- Picture labels fit, and Chinese labels wrap between characters.
- The status strip shows the translation's AI review label.
- `document.documentElement.scrollWidth` equals the viewport width.

- [ ] **Step 4: Commit**

```bash
git add guide/assets/logic.js guide/assets/guide.js tests/v2-guide-logic.test.mjs
git commit -m "feat: the guide says who reviewed the translation"
```

---

### Task 11: Record the slice

**Files:**
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Update the status document**

Add a September 18 paragraph for slice 4: languages available, review status and receipts, narration voices, the ledger total, and what a human translator must still check before any patient use.

- [ ] **Step 2: Run everything and commit**

Run: `npm run check`
Expected: every validator and test passes.

```bash
git add docs/PROJECT_STATUS.md
git commit -m "docs: record slice 4"
```
