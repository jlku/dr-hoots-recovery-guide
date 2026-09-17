# AVS v2 Slice 2: Contents Page and Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the patient-facing web surface of AVS v2: a contents page that lists the five segments with a language selector and subtitle toggle, and a player that plays one segment's narration while swapping frames and showing synchronized captions, all driven by the slice-one timelines at zero provider spend.

**Architecture:** Two static pages under `guide/` share one stylesheet and a small set of ES modules. `logic.js` holds every DOM-free rule (fragment parameters, language fallback, clock-to-beat/cue/word resolution) so Node tests cover it directly; `data.js` fetches the content, media index, frame manifest, language pack, and review index; `frames.js` renders one frame; `toc.js` and `player.js` wire the DOM. A new frame manifest in `content/frames/` maps each beat's frame id to an SVG card, an illustration, or a live-text card, and a validator keeps it consistent with the segments. The player's clock is the concatenated segment MP3, whose silences already match the timeline, so timeline seconds equal audio seconds.

**Tech Stack:** Vanilla ES modules, plain CSS with the design-system tokens, `node:test`, the existing `scripts/serve.mjs` dev server. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md`, sections 4, 6, 8, 9, 11, 12, 13, 14.

## Global Constraints

- Node `>=20.6`; vanilla ES modules and JSON; no framework and no build step; `scripts/serve.mjs` serves everything including `text/vtt`.
- Canvas `1080 x 1920` at `30` fps in data; on screen one `9:16` composition: title strip, square diagram stage, fixed two-line caption band in large type that never moves or shrinks.
- Tokens from `design-system.html`: navy `#052049`, blue `#0071ad`, teal `#14828c`, yellow `#feb80a`, `Helvetica Neue`, paper background, numbered-frame grammar.
- Every content file carries `patient_use: false`; every page shows `Private prototype. Not for patient use.`; no production IDs (no `scene/`, `beat/`, or record ids) in patient-facing text.
- Patient link parameters ride in the URL fragment: `s` segment number, `l` language (`en`, `es`, `zh-Hans`), and pass-through `a`, `p`, `f`, `r` for later slices. Nothing patient-specific goes in the query string.
- Missing language assets fall back to English with a visible notice. Missing review index shows "Not yet reviewed". Conditional beats that are `pending_clinician_text` are skipped and noted in the status strip, never in the reading flow.
- Keyboard operable, visible focus, `prefers-reduced-motion` honored, no autoplay, no audio-only information (a live-text transcript accompanies every segment).
- Frozen or retired code is not revived; slice 1 files are consumed unchanged.
- Zero provider spend. Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

- `content/frames/ci-phase0-v0.1.0.frames.json`: frame id → `{ kind: "svg" | "image" | "text", src?, alt?, title_key? }`.
- `scripts/lib/frames.mjs`, `scripts/validate-frames.mjs`: manifest loader and validator (every beat frame exists, sources exist on disk, alt text present, kinds valid).
- `guide/assets/logic.js`: pure helpers.
- `guide/assets/data.js`: fetch and resolve.
- `guide/assets/frames.js`: DOM rendering of frames and title cards.
- `guide/assets/guide.css`: tokens and layout for both pages.
- `guide/index.html` + `guide/assets/toc.js`: contents page.
- `guide/watch.html` + `guide/assets/player.js`: player.
- `tests/v2-frames.test.mjs`, `tests/v2-guide-logic.test.mjs`, `tests/v2-guide-structure.test.mjs`.
- Modified: `content/translations/en/ci-phase0-v0.1.0.json` and `scripts/lib/language-packs.mjs` (new UI label keys), `package.json` (`frames:validate` in `check`), `index.html` and `README.md` (link to the guide).

---

### Task 1: Frame manifest and validator

**Files:**
- Create: `content/frames/ci-phase0-v0.1.0.frames.json`
- Create: `scripts/lib/frames.mjs`
- Create: `scripts/validate-frames.mjs`
- Modify: `package.json` (add `frames:validate`, run it in `check` right after `segments:validate`)
- Test: `tests/v2-frames.test.mjs`

**Interfaces:**
- Consumes: `loadSegmentBundle(root)` from `scripts/lib/segments.mjs`; beat `frame` ids from the segments file: `frame-01`, `frame-0203-paths`, `frame-0405-milestones`, `frame-medication-pending`, `frame-06-redness`, `frame-0710-anylist`, `frame-11-numbers`, `frame-12-healing`, `frame-13-programming`, `frame-14-follow-up`.
- Produces: `FRAMES_PATH`, `FRAME_KINDS`, `loadFrameManifest(root) -> manifest`, `validateFrames({ frames, segments, root }) -> { valid, errors, warnings }`. The manifest's `frames[id]` objects are what `guide/assets/frames.js` renders in Task 4.

- [x] **Step 1: Write the failing test**

```js
// tests/v2-frames.test.mjs
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { FRAME_KINDS, loadFrameManifest, validateFrames } from "../scripts/lib/frames.mjs";
import { loadSegmentBundle } from "../scripts/lib/segments.mjs";

const root = resolve(import.meta.dirname, "..");
const bundle = await loadSegmentBundle(root);
const frames = await loadFrameManifest(root);

test("the repository frame manifest covers every beat with real files and alt text", async () => {
  const result = await validateFrames({ frames, segments: bundle.segments, root });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(FRAME_KINDS, ["svg", "image", "text"]);
  assert.equal(frames.frames["frame-13-programming"].kind, "image");
  assert.equal(frames.frames["frame-12-healing"].kind, "text");
});

test("the validator rejects unknown frames, missing files, bad kinds, and missing alt text", async () => {
  const broken = structuredClone(frames);
  const segments = structuredClone(bundle.segments);
  segments.segments[0].beats[0].frame = "frame-nope";
  broken.frames["frame-06-redness"].src = "preview/assets/cards/does-not-exist.svg";
  broken.frames["frame-11-numbers"].alt = " ";
  broken.frames["frame-12-healing"].src = "preview/assets/cards/frame-01.svg";
  broken.frames["frame-0405-milestones"].kind = "video";
  const result = await validateFrames({ frames: broken, segments, root });
  const text = result.errors.join("\n");
  assert.match(text, /beat\/dressing-off uses frame frame-nope, which is not in the manifest/);
  assert.match(text, /frame-06-redness src preview\/assets\/cards\/does-not-exist\.svg does not exist/);
  assert.match(text, /frame-11-numbers needs alt text/);
  assert.match(text, /frame-12-healing is a text frame and must not have src/);
  assert.match(text, /frame-0405-milestones has unsupported kind video/);
  assert.match(result.warnings.join("\n"), /frame-01 is not used by any beat/);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v2-frames.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/lib/frames.mjs'`

- [x] **Step 3: Write the manifest**

```json
{
  "schema_version": "1.0",
  "artifact_id": "ci-phase0",
  "artifact_version": "0.1.0",
  "status": "unverified_draft",
  "patient_use": false,
  "notice": "UNVERIFIED — NOT FOR PATIENT USE",
  "frames": {
    "frame-01": { "kind": "svg", "src": "preview/assets/cards/frame-01.svg", "alt": "Day 2: remove the head dressing, then check behind the ear for tape." },
    "frame-0203-paths": { "kind": "svg", "src": "preview/assets/cards/frame-0203-paths.svg", "alt": "Two paths. Tape present: keep the area dry until three days after surgery and do not clean it. No tape: clean the incision edges gently twice a day with equal parts hydrogen peroxide and distilled water, then apply antibiotic ointment." },
    "frame-0405-milestones": { "kind": "svg", "src": "preview/assets/cards/frame-0405-milestones.svg", "alt": "Three days after surgery you may shower and wash your hair. The wound check and ear exam are about two weeks after surgery. The stitches dissolve." },
    "frame-medication-pending": { "kind": "text", "title_key": "ui.pending_clinician_text" },
    "frame-06-redness": { "kind": "svg", "src": "preview/assets/cards/frame-06-redness.svg", "alt": "Call your surgeon or clinic if all three signs are present: the incision is red and swollen, it does not get better over one to two days, and it hurts when touched." },
    "frame-0710-anylist": { "kind": "svg", "src": "preview/assets/cards/frame-0710-anylist.svg", "alt": "Call for any of these: a fever above 101.5 degrees Fahrenheit; swelling or fluid behind the ear; a headache, light sensitivity, or excessive lethargy; or any wound-care question or concern." },
    "frame-11-numbers": { "kind": "svg", "src": "preview/assets/cards/frame-11-numbers.svg", "alt": "Routine questions: leave a message on the nursing line at 415-353-2148 and expect a call within 12 hours; if no one calls, call again. Emergency: call 415-476-1000 and ask for the Otolaryngology resident on call." },
    "frame-12-healing": { "kind": "text" },
    "frame-13-programming": { "kind": "image", "src": "assets/illustrations/ci-activation-programming-safety-card-v1.png", "alt": "A hearing specialist uses a laptop to program an adult patient's external behind-the-ear speech processor, with a close-up of the processor and adjustment controls." },
    "frame-14-follow-up": { "kind": "text" }
  }
}
```

- [x] **Step 4: Write the library and CLI**

```js
// scripts/lib/frames.mjs
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export const FRAMES_PATH = "content/frames/ci-phase0-v0.1.0.frames.json";
export const FRAME_KINDS = Object.freeze(["svg", "image", "text"]);

export async function loadFrameManifest(root, path = FRAMES_PATH) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function validateFrames({ frames, segments, root }) {
  const errors = [];
  const warnings = [];
  if (frames.patient_use !== false) errors.push("patient_use must be false");
  if (frames.artifact_id !== segments.artifact_id || frames.artifact_version !== segments.artifact_version) {
    errors.push("frames must reference the segments artifact id and version");
  }
  const catalog = frames.frames ?? {};
  const used = new Set();
  for (const segment of segments.segments ?? []) {
    for (const beat of segment.beats ?? []) {
      used.add(beat.frame);
      if (!catalog[beat.frame]) errors.push(`${beat.id} uses frame ${beat.frame}, which is not in the manifest`);
    }
  }
  for (const [id, frame] of Object.entries(catalog)) {
    if (!FRAME_KINDS.includes(frame.kind)) {
      errors.push(`${id} has unsupported kind ${frame.kind}`);
      continue;
    }
    if (frame.kind === "text") {
      if (frame.src) errors.push(`${id} is a text frame and must not have src`);
      continue;
    }
    if (!frame.src) {
      errors.push(`${id} needs src`);
      continue;
    }
    if (typeof frame.alt !== "string" || !frame.alt.trim()) errors.push(`${id} needs alt text`);
    if (frame.kind === "svg" && !frame.src.endsWith(".svg")) errors.push(`${id} svg frames must point at an .svg file`);
    if (!(await exists(join(root, frame.src)))) errors.push(`${id} src ${frame.src} does not exist`);
  }
  for (const id of Object.keys(catalog)) {
    if (!used.has(id)) warnings.push(`${id} is not used by any beat`);
  }
  return { valid: errors.length === 0, errors, warnings };
}
```

```js
// scripts/validate-frames.mjs
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadFrameManifest, validateFrames } from "./lib/frames.mjs";
import { loadSegmentBundle } from "./lib/segments.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const bundle = await loadSegmentBundle(repositoryRoot);
  const frames = await loadFrameManifest(repositoryRoot);
  const result = await validateFrames({ frames, segments: bundle.segments, root: repositoryRoot });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (!result.valid) {
    for (const error of result.errors) console.error(`error: ${error}`);
    process.exit(1);
  }
  console.log(`frames valid: ${Object.keys(frames.frames).length} frames cover every beat`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

- [x] **Step 5: Wire the npm script**

In `package.json` add `"frames:validate": "node scripts/validate-frames.mjs"` next to `segments:validate`, and change `check` to `npm run content:validate && npm run copy:validate && npm run media:validate && npm run narration:validate && npm run segments:validate && npm run frames:validate && npm run translations:validate && npm run test:unit`.

- [x] **Step 6: Run the test and the CLI**

Run: `node --test tests/v2-frames.test.mjs && node scripts/validate-frames.mjs`
Expected: `# pass 2` and `frames valid: 10 frames cover every beat`

- [x] **Step 7: Commit**

```bash
git add content/frames scripts/lib/frames.mjs scripts/validate-frames.mjs tests/v2-frames.test.mjs package.json
git commit -m "feat: add the v2 frame manifest and validator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: UI label keys for the pages

**Files:**
- Modify: `scripts/lib/language-packs.mjs` (extend `UI_LABEL_KEYS`)
- Modify: `content/translations/en/ci-phase0-v0.1.0.json` (add the labels)
- Test: `tests/v2-language-packs.test.mjs` (existing; one assertion added)

**Interfaces:**
- Produces the label keys `ui.seek`, `ui.coming`, `ui.language_fallback`, `ui.not_reviewed`, `ui.replay`, `ui.transcript`, `ui.review_status` that `toc.js` and `player.js` read. Every later language pack must supply them, which the validator enforces.

- [x] **Step 1: Extend the existing test**

Append to `tests/v2-language-packs.test.mjs`:

```js
test("the page label keys are required in every pack", () => {
  for (const key of ["ui.seek", "ui.coming", "ui.language_fallback", "ui.not_reviewed", "ui.replay", "ui.transcript", "ui.review_status"]) {
    assert.ok(requiredLabelKeys(bundle.segments).includes(key), key);
    assert.ok(englishPack.labels[key]?.trim(), key);
  }
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --test tests/v2-language-packs.test.mjs`
Expected: 1 failing test naming `ui.seek`.

- [x] **Step 3: Add the keys**

In `scripts/lib/language-packs.mjs` extend `UI_LABEL_KEYS` with `"ui.seek", "ui.coming", "ui.language_fallback", "ui.not_reviewed", "ui.replay", "ui.transcript", "ui.review_status"`.

In the English pack add inside `labels`:

```json
    "ui.seek": "Seek",
    "ui.coming": "coming soon",
    "ui.language_fallback": "This language is not available yet. Showing English.",
    "ui.not_reviewed": "Not yet reviewed",
    "ui.replay": "Replay",
    "ui.transcript": "Transcript",
    "ui.review_status": "Review status"
```

- [x] **Step 4: Run the tests and validator**

Run: `node --test tests/v2-language-packs.test.mjs && node scripts/validate-translations.mjs`
Expected: `# pass 5` and `content/translations/en/ci-phase0-v0.1.0.json: valid (en, source)`

- [x] **Step 5: Commit**

```bash
git add scripts/lib/language-packs.mjs content/translations/en/ci-phase0-v0.1.0.json tests/v2-language-packs.test.mjs
git commit -m "feat: add page label keys to the language packs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pure guide logic

**Files:**
- Create: `guide/assets/logic.js`
- Test: `tests/v2-guide-logic.test.mjs`

**Interfaces:**
- Produces: `LANGUAGES`, `normalizeLanguage(code)`, `parseFragment(hash) -> object`, `buildFragment(params) -> "#..." | ""`, `pickEntry(index, number, language) -> { entry, fallback }`, `availableLanguages(index) -> string[]`, `activeBeat(timeline, seconds) -> beat | null`, `activeCue(timeline, seconds) -> cue | null`, `assignWordsToCues(timeline) -> Map<cueId, word[]>`, `activeWordIndex(words, seconds) -> number`, `formatTime(seconds) -> "m:ss"`, `segmentByNumber(segments, number)`, `pendingConditionalBeats(segment)`. Timeline and index shapes are the slice-one outputs in `assets/captions/v2/`.

- [x] **Step 1: Write the failing test**

```js
// tests/v2-guide-logic.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  activeBeat,
  activeCue,
  activeWordIndex,
  assignWordsToCues,
  availableLanguages,
  buildFragment,
  formatTime,
  normalizeLanguage,
  parseFragment,
  pendingConditionalBeats,
  pickEntry,
  segmentByNumber
} from "../guide/assets/logic.js";

const root = resolve(import.meta.dirname, "..");
const timeline = JSON.parse(await readFile(resolve(root, "assets/captions/v2/en/incision-day2.timeline.json"), "utf8"));
const index = JSON.parse(await readFile(resolve(root, "assets/captions/v2/index.json"), "utf8"));
const segments = JSON.parse(await readFile(resolve(root, "content/segments/ci-phase0-v0.1.0.segments.json"), "utf8"));

test("fragment parameters round-trip and unknown languages fall back to English", () => {
  assert.deepEqual(parseFragment("#s=2&l=es&f=2026-10-01"), { s: "2", l: "es", f: "2026-10-01" });
  assert.equal(buildFragment({ s: 2, l: "es", f: "2026-10-01", empty: "" }), "#s=2&l=es&f=2026-10-01");
  assert.equal(buildFragment({}), "");
  assert.equal(normalizeLanguage("zh-Hans"), "zh-Hans");
  assert.equal(normalizeLanguage("fr"), "en");
  assert.equal(normalizeLanguage(undefined), "en");
});

test("media entries pick the requested language or fall back to English with a flag", () => {
  assert.deepEqual(availableLanguages(index), ["en"]);
  const exact = pickEntry(index, 1, "en");
  assert.equal(exact.fallback, false);
  assert.equal(exact.entry.segment_id, "seg/incision-day2");
  const fallback = pickEntry(index, 1, "es");
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.entry.language, "en");
  assert.equal(pickEntry(index, 9, "en").entry, null);
  assert.equal(segmentByNumber(segments, 2).id, "seg/next-two-weeks");
  assert.equal(segmentByNumber(segments, 9), null);
  assert.equal(pendingConditionalBeats(segmentByNumber(segments, 2)).length, 2);
  assert.equal(pendingConditionalBeats(segmentByNumber(segments, 1)).length, 0);
});

test("the clock resolves title card, beats, cues, and active words from a real timeline", () => {
  assert.equal(activeBeat(timeline, 0), null);
  assert.equal(activeBeat(timeline, 1.5).id, "beat/dressing-off");
  assert.equal(activeBeat(timeline, timeline.beats[1].start).id, "beat/two-paths");
  assert.equal(activeBeat(timeline, timeline.beats[0].end + 0.1).id, "beat/dressing-off");
  assert.equal(activeCue(timeline, 0), null);
  assert.equal(activeCue(timeline, 1.5).id, "cue-01");
  const words = assignWordsToCues(timeline);
  assert.equal([...words.values()].flat().length, timeline.words.length);
  assert.equal(words.get("cue-01")[0].text, "Two");
  assert.equal(activeWordIndex(words.get("cue-01"), 1.5), 0);
  assert.equal(activeWordIndex(words.get("cue-01"), 0), -1);
  assert.equal(activeWordIndex(words.get("cue-01"), timeline.cues[0].end), words.get("cue-01").length - 1);
});

test("time formats as minutes and seconds", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65.4), "1:05");
  assert.equal(formatTime(28.76), "0:29");
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test tests/v2-guide-logic.test.mjs`
Expected: FAIL with `Cannot find module '.../guide/assets/logic.js'`

- [x] **Step 3: Write the module**

```js
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
```

- [x] **Step 4: Run the test to verify it passes**

Run: `node --test tests/v2-guide-logic.test.mjs`
Expected: `# pass 4`

- [x] **Step 5: Commit**

```bash
git add guide/assets/logic.js tests/v2-guide-logic.test.mjs
git commit -m "feat: add pure guide logic for fragments, languages, and the caption clock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Contents page

**Files:**
- Create: `guide/assets/data.js`
- Create: `guide/assets/frames.js`
- Create: `guide/assets/guide.css`
- Create: `guide/index.html`
- Create: `guide/assets/toc.js`
- Test: `tests/v2-guide-structure.test.mjs` (first two tests; the player tests join in Task 5)

**Interfaces:**
- Consumes: `logic.js` from Task 3; the frame manifest from Task 1; labels from Task 2; `assets/captions/v2/index.json`.
- Produces: `assetUrl(path)`, `fetchJson(path)`, `fetchOptionalJson(path)`, `canonicalSentences(canonical)`, `loadGuide(language) -> { language, segments, canonical, index, frames, pack, packFallback, sentences, reviews }` in `data.js`; `renderFrame(frame, { beat, sentences, pack }) -> Element` and `renderTitleCard(segment, pack) -> Element` in `frames.js`. The player in Task 5 reuses all of them and the same stylesheet.
- Review index shape read by the badges: `{ entries: [{ label, date, status }] }`; absent file shows the `ui.not_reviewed` label.

- [x] **Step 1: Write the failing structure tests**

```js
// tests/v2-guide-structure.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("the contents page exposes the language selector, subtitle toggle, list, card link, and review badges", async () => {
  const html = await read("guide/index.html");
  for (const id of ["guide-title", "guide-subtitle", "language", "subtitles-toggle", "segment-list", "card-link", "review-badges", "notice", "fallback-notice"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<html lang="en">/);
  assert.match(html, /output\/pdf\/airline-safety-card-deck-prototype\.pdf/);
  assert.match(html, /Private prototype\. Not for patient use\./);
  assert.match(html, /<script type="module" src="assets\/toc\.js">/);
  assert.doesNotMatch(html, /scene\//);
});

test("the stylesheet fixes the caption band height, honors reduced motion, and keeps a 9:16 canvas", async () => {
  const css = await read("guide/assets/guide.css");
  assert.match(css, /\.caption-band\s*\{[^}]*min-height:/s);
  assert.match(css, /aspect-ratio:\s*9 \/ 16/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /--teal:\s*#14828c/);
  assert.match(css, /:focus-visible/);
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `node --test tests/v2-guide-structure.test.mjs`
Expected: 2 failing tests with `ENOENT` for `guide/index.html`.

- [x] **Step 3: Write `data.js`**

```js
// guide/assets/data.js
// Fetches the content, media index, frames, language pack, and reviews the guide pages need.
import { normalizeLanguage } from "./logic.js";

const ROOT = new URL("../../", import.meta.url);
const ARTIFACT = "ci-phase0-v0.1.0";

export function assetUrl(path) {
  return new URL(path, ROOT).href;
}

export async function fetchJson(path) {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

export async function fetchOptionalJson(path) {
  try {
    return await fetchJson(path);
  } catch {
    return null;
  }
}

export function canonicalSentences(canonical) {
  return new Map(canonical.modules.flatMap((module) => module.canonical_sentences.map((sentence) => [sentence.id, sentence.text])));
}

export async function loadGuide(requestedLanguage) {
  const language = normalizeLanguage(requestedLanguage);
  const [segments, canonical, index, frames] = await Promise.all([
    fetchJson(`content/segments/${ARTIFACT}.segments.json`),
    fetchJson(`content/canonical/${ARTIFACT}.json`),
    fetchJson("assets/captions/v2/index.json"),
    fetchJson(`content/frames/${ARTIFACT}.frames.json`)
  ]);
  let pack = language === "en" ? null : await fetchOptionalJson(`content/translations/${language}/${ARTIFACT}.json`);
  let packFallback = false;
  if (!pack) {
    pack = await fetchJson(`content/translations/en/${ARTIFACT}.json`);
    packFallback = language !== "en";
  }
  const sentences = pack.language === "en" ? canonicalSentences(canonical) : new Map(Object.entries(pack.sentences ?? {}));
  const reviews = await fetchOptionalJson("content/reviews/index.json");
  return { language, segments, canonical, index, frames, pack, packFallback, sentences, reviews };
}
```

- [x] **Step 4: Write `frames.js`**

```js
// guide/assets/frames.js
// Renders one frame into the diagram stage: an SVG card, an illustration, or live text.
import { assetUrl } from "./data.js";

export function renderFrame(frame, { beat, sentences, pack }) {
  const stage = document.createElement("div");
  stage.className = `frame frame--${frame.kind}`;
  if (frame.kind === "text") {
    const card = document.createElement("div");
    card.className = "text-card";
    if (frame.title_key) {
      const lead = document.createElement("p");
      lead.className = "text-card__lead";
      lead.textContent = pack.labels[frame.title_key] ?? "";
      card.append(lead);
    }
    const list = document.createElement("ul");
    list.className = "text-card__list";
    for (const id of beat?.sentence_ids ?? []) {
      const item = document.createElement("li");
      item.dataset.sentenceId = id;
      item.textContent = sentences.get(id) ?? "";
      list.append(item);
    }
    card.append(list);
    stage.append(card);
    return stage;
  }
  const image = document.createElement("img");
  image.src = assetUrl(frame.src);
  image.alt = frame.alt ?? "";
  image.decoding = "async";
  stage.append(image);
  return stage;
}

export function renderTitleCard(segment, pack) {
  const card = document.createElement("div");
  card.className = "frame frame--title";
  const number = document.createElement("span");
  number.className = "title-card__number";
  number.textContent = String(segment.number).padStart(2, "0");
  const title = document.createElement("h2");
  title.className = "title-card__title";
  title.textContent = pack.labels[segment.title_key] ?? "";
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = pack.labels[segment.chip_key] ?? "";
  card.append(number, title, chip);
  return card;
}
```

- [x] **Step 5: Write the stylesheet**

```css
/* guide/assets/guide.css — tokens from design-system.html; layout for the contents page and the player. */
:root {
  --navy: #052049;
  --blue: #0071ad;
  --cta: #006be9;
  --teal: #14828c;
  --yellow: #feb80a;
  --gray-1: #f2f3f4;
  --gray-3: #d1d3d3;
  --blue-gray: #506380;
  --paper: #fff;
  --sans: "Helvetica Neue", Helvetica, Arial, sans-serif;
  --gutter: 16px;
  --content: min(1040px, calc(100vw - 2 * var(--gutter)));
  --canvas-width: min(100%, 430px, calc((100svh - 240px) * 9 / 16));
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--navy); font-family: var(--sans); font-size: 18px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
a { color: var(--blue); text-underline-offset: 4px; }
:focus-visible { outline: 3px solid var(--teal); outline-offset: 3px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* Contents page */
.toc-page .masthead, .toc-page .controls, .toc-page main, .toc-page .status-strip, .toc-page .fallback-notice { width: var(--content); margin-inline: auto; }
.masthead { padding: 32px 0 12px; border-bottom: 5px solid var(--teal); }
.eyebrow { margin: 0 0 8px; color: var(--teal); font-size: 14px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.masthead h1 { margin: 0 0 8px; font-size: clamp(30px, 5vw, 44px); font-weight: 300; letter-spacing: -.03em; line-height: 1.05; text-wrap: balance; }
.lede { margin: 0 0 12px; color: var(--blue-gray); font-size: clamp(18px, 2.2vw, 21px); }
.controls { display: flex; flex-wrap: wrap; gap: 12px 28px; padding: 16px 0; }
.control { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; }
.control select { min-height: 44px; padding: 8px 12px; border: 1px solid var(--gray-3); border-radius: 6px; background: var(--paper); color: var(--navy); font: inherit; }
.control input[type="checkbox"] { width: 22px; height: 22px; margin: 0; accent-color: var(--teal); }
.segment-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.segment__link { display: grid; grid-template-columns: 96px auto 1fr; grid-template-rows: auto auto; gap: 4px 16px; align-items: center; min-height: 88px; padding: 12px; border: 1px solid var(--gray-3); border-radius: 8px; color: inherit; text-decoration: none; background: var(--paper); }
.segment__link:hover { border-color: var(--blue); }
.thumb { grid-row: 1 / span 2; width: 96px; aspect-ratio: 4 / 3; display: grid; place-items: center; overflow: hidden; border-radius: 6px; background: var(--gray-1); }
.thumb img { width: 100%; height: 100%; object-fit: contain; }
.thumb--text { color: var(--teal); font-size: 28px; font-weight: 800; }
.segment__number { color: var(--teal); font-size: 14px; font-weight: 800; letter-spacing: .08em; }
.segment__title { grid-column: 2 / span 2; font-size: clamp(18px, 2.4vw, 22px); font-weight: 600; line-height: 1.25; }
.segment__meta { grid-column: 2 / span 2; color: var(--blue-gray); font-size: 15px; }
.card-row { margin: 24px 0; }
.card-link { font-weight: 700; }
.status-strip { padding: 16px 0 32px; border-top: 1px solid var(--gray-3); color: var(--blue-gray); font-size: 15px; }
.status-strip p { margin: 0 0 8px; }
.status-strip h2 { margin: 12px 0 6px; font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.badges { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.badge { padding: 4px 10px; border: 1px solid var(--gray-3); border-radius: 999px; font-size: 13px; font-weight: 600; }
.fallback-notice { margin: 0 0 8px; padding: 10px 12px; background: #fff6d6; border: 1px solid var(--yellow); border-radius: 6px; font-size: 15px; }
.fallback-notice[hidden] { display: none; }

/* Player page */
.watch-page .topbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; width: var(--content); margin-inline: auto; padding: 12px 0; }
.topbar__link { font-weight: 700; }
.player { width: var(--canvas-width); margin: 0 auto 32px; padding: 0 var(--gutter); }
.canvas { display: grid; grid-template-rows: auto 1fr auto; aspect-ratio: 9 / 16; width: 100%; overflow: hidden; border: 1px solid var(--gray-3); border-radius: 12px; background: var(--paper); }
.title-strip { padding: 14px 16px 10px; border-bottom: 4px solid var(--teal); }
.title-strip .frame--title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.title-strip .title-card__title { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.2; }
.title-card__number { color: var(--teal); font-size: 13px; font-weight: 800; letter-spacing: .08em; }
.chip { padding: 2px 8px; border-radius: 999px; background: var(--yellow); color: var(--navy); font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.stage { display: grid; place-items: center; min-height: 0; padding: 12px; }
.frame { width: 100%; height: 100%; display: grid; place-items: center; }
.frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
.frame--title { align-content: center; justify-items: center; gap: 10px; text-align: center; }
.stage .frame--title .title-card__title { margin: 0; font-size: clamp(22px, 6vw, 30px); font-weight: 300; letter-spacing: -.02em; line-height: 1.1; }
.text-card { width: 100%; padding: 8px 6px; }
.text-card__lead { margin: 0 0 10px; color: var(--blue-gray); font-size: 15px; }
.text-card__list { margin: 0; padding-left: 1.1em; display: grid; gap: 10px; font-size: clamp(17px, 4.6vw, 21px); line-height: 1.35; }
.caption-band { min-height: calc(2 * 1.3em + 28px); padding: 14px 16px; background: var(--navy); color: #fff; font-size: clamp(18px, 5vw, 22px); font-weight: 600; line-height: 1.3; }
.caption-band[hidden] { display: none; }
.caption { margin: 0; }
.word { display: inline-block; margin-right: .28em; border-radius: 3px; }
.word.is-active { background: var(--yellow); color: var(--navy); }
.transport { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-top: 14px; }
.scrubber { flex: 1 1 160px; accent-color: var(--teal); }
.time { font-variant-numeric: tabular-nums; font-size: 15px; color: var(--blue-gray); }
.control--inline { font-size: 15px; }
.button { min-height: 44px; padding: 8px 18px; border: 1px solid var(--navy); border-radius: 6px; background: var(--paper); color: var(--navy); font: inherit; font-weight: 700; cursor: pointer; }
.button--primary { background: var(--navy); color: #fff; }
.button:disabled { opacity: .45; cursor: default; }
.segment-nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 14px; }
.transcript { margin-top: 18px; font-size: 16px; }
.transcript summary { font-weight: 700; cursor: pointer; }
.transcript p { margin: 8px 0; }
.watch-page .status-strip { width: var(--canvas-width); margin-inline: auto; padding-inline: var(--gutter); }

@media (max-width: 480px) {
  .masthead { padding-top: 20px; }
  .segment__link { grid-template-columns: 72px auto 1fr; }
  .thumb { width: 72px; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
```

- [x] **Step 6: Write `guide/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Recovery guide</title>
  <link rel="stylesheet" href="assets/guide.css">
</head>
<body class="toc-page">
  <header class="masthead">
    <p class="eyebrow">Cochlear implant recovery</p>
    <h1 id="guide-title">Your cochlear implant recovery guide</h1>
    <p class="lede" id="guide-subtitle">Five short videos. Start with the one you are wondering about.</p>
  </header>
  <section class="controls" aria-label="Guide settings">
    <label class="control"><span id="language-label">Language</span><select id="language"></select></label>
    <label class="control"><input id="subtitles-toggle" type="checkbox" checked><span id="subtitles-label">Subtitles</span></label>
  </section>
  <p class="fallback-notice" id="fallback-notice" hidden></p>
  <main>
    <ol class="segment-list" id="segment-list" aria-label="Contents"></ol>
    <p class="card-row"><a id="card-link" class="card-link" href="../output/pdf/airline-safety-card-deck-prototype.pdf">Printable card</a></p>
  </main>
  <footer class="status-strip">
    <p id="notice">Private prototype. Not for patient use.</p>
    <h2 id="review-heading">Review status</h2>
    <ul class="badges" id="review-badges" aria-labelledby="review-heading"></ul>
  </footer>
  <noscript><p class="status-strip">This guide needs JavaScript. Private prototype. Not for patient use.</p></noscript>
  <script type="module" src="assets/toc.js"></script>
</body>
</html>
```

- [x] **Step 7: Write `toc.js`**

```js
// guide/assets/toc.js
import { assetUrl, loadGuide } from "./data.js";
import { LANGUAGES, availableLanguages, buildFragment, formatTime, normalizeLanguage, parseFragment, pickEntry } from "./logic.js";

const SUBTITLES_KEY = "recovery-guide-subtitles";
const dom = {
  title: document.querySelector("#guide-title"),
  subtitle: document.querySelector("#guide-subtitle"),
  list: document.querySelector("#segment-list"),
  language: document.querySelector("#language"),
  languageLabel: document.querySelector("#language-label"),
  subtitles: document.querySelector("#subtitles-toggle"),
  subtitlesLabel: document.querySelector("#subtitles-label"),
  card: document.querySelector("#card-link"),
  badges: document.querySelector("#review-badges"),
  reviewHeading: document.querySelector("#review-heading"),
  notice: document.querySelector("#notice"),
  fallback: document.querySelector("#fallback-notice")
};

function readPreference() {
  try {
    return localStorage.getItem(SUBTITLES_KEY) !== "off";
  } catch {
    return true;
  }
}

function writePreference(on) {
  try {
    localStorage.setItem(SUBTITLES_KEY, on ? "on" : "off");
  } catch {
    /* per-viewer convenience only */
  }
}

function thumbnail(segment, guide) {
  const firstBeat = segment.beats.find((beat) => !beat.condition) ?? segment.beats[0];
  const frame = guide.frames.frames[firstBeat.frame];
  const box = document.createElement("div");
  box.className = "thumb";
  if (frame?.src) {
    const image = document.createElement("img");
    image.src = assetUrl(frame.src);
    image.alt = "";
    image.loading = "lazy";
    box.append(image);
  } else {
    box.classList.add("thumb--text");
    box.textContent = String(segment.number).padStart(2, "0");
  }
  return box;
}

function renderBadges(guide) {
  const labels = guide.pack.labels;
  const entries = guide.reviews?.entries ?? [];
  const items = entries.length ? entries : [{ label: labels["ui.not_reviewed"], date: null, status: null }];
  dom.badges.replaceChildren(...items.map((item) => {
    const badge = document.createElement("li");
    badge.className = "badge";
    badge.textContent = [item.label, item.status, item.date].filter(Boolean).join(" · ");
    return badge;
  }));
}

function renderLanguages(guide) {
  const available = availableLanguages(guide.index);
  dom.language.replaceChildren(...LANGUAGES.map((language) => {
    const option = document.createElement("option");
    option.value = language.code;
    option.disabled = !available.includes(language.code);
    option.textContent = option.disabled ? `${language.label} · ${guide.pack.labels["ui.coming"]}` : language.label;
    option.selected = language.code === guide.language;
    return option;
  }));
}

function renderList(guide, params) {
  const labels = guide.pack.labels;
  dom.list.replaceChildren(...guide.segments.segments.map((segment) => {
    const item = document.createElement("li");
    item.className = "segment";
    const link = document.createElement("a");
    link.className = "segment__link";
    link.href = `watch.html${buildFragment({ ...params, l: guide.language, s: segment.number })}`;
    const number = document.createElement("span");
    number.className = "segment__number";
    number.textContent = String(segment.number).padStart(2, "0");
    const title = document.createElement("span");
    title.className = "segment__title";
    title.textContent = labels[segment.title_key] ?? "";
    const meta = document.createElement("span");
    meta.className = "segment__meta";
    const picked = pickEntry(guide.index, segment.number, guide.language);
    meta.textContent = [labels[segment.chip_key], picked.entry ? formatTime(picked.entry.duration_seconds) : null].filter(Boolean).join(" · ");
    link.append(thumbnail(segment, guide), number, title, meta);
    item.append(link);
    return item;
  }));
}

async function init() {
  const params = parseFragment(location.hash);
  const guide = await loadGuide(params.l);
  const labels = guide.pack.labels;
  document.documentElement.lang = guide.pack.language;
  document.title = labels["guide.title"];
  dom.title.textContent = labels["guide.title"];
  dom.subtitle.textContent = labels["guide.subtitle"];
  dom.languageLabel.textContent = labels["ui.language"];
  dom.subtitlesLabel.textContent = labels["ui.subtitles"];
  dom.card.textContent = labels["ui.card"];
  dom.notice.textContent = labels["ui.notice"];
  dom.reviewHeading.textContent = labels["ui.review_status"];
  dom.fallback.textContent = labels["ui.language_fallback"];
  dom.fallback.hidden = !guide.packFallback;
  dom.subtitles.checked = readPreference();
  renderLanguages(guide);
  renderList(guide, params);
  renderBadges(guide);
  window.__guideContents = { getState: () => ({ language: guide.language, segments: guide.segments.segments.length, fallback: guide.packFallback }) };
}

function showError(error) {
  dom.notice.textContent = error.message;
}

dom.language.addEventListener("change", () => {
  location.hash = buildFragment({ ...parseFragment(location.hash), l: normalizeLanguage(dom.language.value) });
});
dom.subtitles.addEventListener("change", () => writePreference(dom.subtitles.checked));
window.addEventListener("hashchange", () => init().catch(showError));
init().catch(showError);
```

- [x] **Step 8: Run the structure tests**

Run: `node --test tests/v2-guide-structure.test.mjs`
Expected: `# pass 2`

- [x] **Step 9: Verify in the browser**

Add a temporary entry to the ignored `.claude/launch.json` in the main checkout that serves this worktree with `node scripts/serve.mjs` (`PORT=4175`, `runtimeExecutable: "node"`, `runtimeArgs: ["<worktree>/scripts/serve.mjs"]`, `env: {"PORT": "4175"}`), start it with `preview_start`, open `http://localhost:4175/guide/index.html`, and check: no console errors; `read_page` shows five list items with titles, chips, and durations; the language select has English enabled and two disabled "coming soon" options; the printable card link resolves; the badge reads "Not yet reviewed"; at the mobile preset there is no horizontal overflow. Remove the launch entry when done.

- [x] **Step 10: Commit**

```bash
git add guide/assets/data.js guide/assets/frames.js guide/assets/guide.css guide/index.html guide/assets/toc.js tests/v2-guide-structure.test.mjs
git commit -m "feat: add the v2 contents page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Player page

**Files:**
- Create: `guide/watch.html`
- Create: `guide/assets/player.js`
- Modify: `tests/v2-guide-structure.test.mjs` (add the player test)

**Interfaces:**
- Consumes: everything from Tasks 3 and 4; timelines and MP3s from `assets/captions/v2/index.json`.
- Produces: `window.__guidePlayer.getState()` returning `{ segment, language, duration, currentTime, frame, cue, subtitles }` for browser verification.

- [x] **Step 1: Add the failing structure test**

Append to `tests/v2-guide-structure.test.mjs`:

```js
test("the player page has one audio element, a fixed caption band, transport controls, segment navigation, and a transcript", async () => {
  const html = await read("guide/watch.html");
  assert.equal((html.match(/<audio /g) ?? []).length, 1);
  for (const id of ["title-strip", "stage", "caption-band", "caption", "play-toggle", "scrubber", "time", "speed", "speed-label", "subtitles-toggle", "subtitles-label", "language", "segment-prev", "segment-next", "transcript", "transcript-summary", "status", "contents-link"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /<input id="scrubber" class="scrubber" type="range"/);
  assert.match(html, /<option value="1" selected>1×<\/option>/);
  assert.match(html, /Private prototype\. Not for patient use\./);
  assert.match(html, /<script type="module" src="assets\/player\.js">/);
  assert.doesNotMatch(html, /autoplay/);
  assert.doesNotMatch(html, /scene\//);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --test tests/v2-guide-structure.test.mjs`
Expected: 2 pass, 1 fail with `ENOENT` for `guide/watch.html`.

- [x] **Step 3: Write `guide/watch.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light">
  <title>Recovery guide</title>
  <link rel="stylesheet" href="assets/guide.css">
</head>
<body class="watch-page">
  <header class="topbar">
    <a id="contents-link" class="topbar__link" href="index.html">Contents</a>
    <label class="control control--inline"><span class="visually-hidden" id="language-label">Language</span><select id="language" aria-labelledby="language-label"></select></label>
  </header>
  <main class="player" id="player">
    <section class="canvas" aria-label="Video">
      <div class="title-strip" id="title-strip"></div>
      <div class="stage" id="stage"></div>
      <div class="caption-band" id="caption-band" role="region" aria-label="Captions"><p class="caption" id="caption"></p></div>
    </section>
    <audio id="audio" preload="metadata"></audio>
    <div class="transport" aria-label="Playback controls">
      <button id="play-toggle" class="button button--primary" type="button" aria-pressed="false">Play</button>
      <input id="scrubber" class="scrubber" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek">
      <output id="time" class="time">0:00 / 0:00</output>
      <label class="control control--inline"><span id="speed-label">Speed</span><select id="speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label>
      <label class="control control--inline"><input id="subtitles-toggle" type="checkbox" checked><span id="subtitles-label">Subtitles</span></label>
    </div>
    <nav class="segment-nav" aria-label="Segments">
      <button id="segment-prev" class="button" type="button">Previous</button>
      <button id="segment-next" class="button" type="button">Next</button>
    </nav>
    <details class="transcript"><summary id="transcript-summary">Transcript</summary><div id="transcript"></div></details>
  </main>
  <footer class="status-strip" id="status"><p>Private prototype. Not for patient use.</p></footer>
  <noscript><p class="status-strip">This guide needs JavaScript. Private prototype. Not for patient use.</p></noscript>
  <script type="module" src="assets/player.js"></script>
</body>
</html>
```

- [x] **Step 4: Write `player.js`**

```js
// guide/assets/player.js
import { assetUrl, fetchJson, loadGuide } from "./data.js";
import { renderFrame, renderTitleCard } from "./frames.js";
import {
  LANGUAGES,
  activeBeat,
  activeCue,
  activeWordIndex,
  assignWordsToCues,
  availableLanguages,
  buildFragment,
  formatTime,
  normalizeLanguage,
  parseFragment,
  pendingConditionalBeats,
  pickEntry,
  segmentByNumber
} from "./logic.js";

const SUBTITLES_KEY = "recovery-guide-subtitles";
const SEEK_STEP_SECONDS = 5;

const dom = {
  titleStrip: document.querySelector("#title-strip"),
  stage: document.querySelector("#stage"),
  caption: document.querySelector("#caption"),
  captionBand: document.querySelector("#caption-band"),
  audio: document.querySelector("#audio"),
  play: document.querySelector("#play-toggle"),
  scrubber: document.querySelector("#scrubber"),
  time: document.querySelector("#time"),
  speed: document.querySelector("#speed"),
  speedLabel: document.querySelector("#speed-label"),
  subtitles: document.querySelector("#subtitles-toggle"),
  subtitlesLabel: document.querySelector("#subtitles-label"),
  language: document.querySelector("#language"),
  languageLabel: document.querySelector("#language-label"),
  prev: document.querySelector("#segment-prev"),
  next: document.querySelector("#segment-next"),
  status: document.querySelector("#status"),
  transcript: document.querySelector("#transcript"),
  transcriptSummary: document.querySelector("#transcript-summary"),
  contentsLink: document.querySelector("#contents-link")
};

let state = null;
let frameId = null;
let cueId = null;
let wordsByCue = new Map();
let rafHandle = 0;

function readPreference() {
  try {
    return localStorage.getItem(SUBTITLES_KEY) !== "off";
  } catch {
    return true;
  }
}

function writePreference(on) {
  try {
    localStorage.setItem(SUBTITLES_KEY, on ? "on" : "off");
  } catch {
    /* per-viewer convenience only */
  }
}

function setStatus(messages) {
  dom.status.replaceChildren(...messages.map((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }));
}

function ensureFrame(id, build) {
  if (frameId === id) return;
  frameId = id;
  dom.stage.replaceChildren(build());
}

function renderCue(cue) {
  cueId = cue?.id ?? null;
  const words = cue ? wordsByCue.get(cue.id) ?? [] : [];
  dom.caption.replaceChildren(...words.map((word) => {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = word.text;
    return span;
  }));
}

function syncToTime(seconds) {
  const { timeline, segment, pack, sentences, frames } = state;
  const beat = activeBeat(timeline, seconds);
  if (!beat) {
    ensureFrame("title", () => renderTitleCard(segment, pack));
  } else {
    ensureFrame(beat.id, () => renderFrame(frames.frames[beat.frame], {
      beat: segment.beats.find((item) => item.id === beat.id),
      sentences,
      pack
    }));
  }
  const cue = activeCue(timeline, seconds);
  if ((cue?.id ?? null) !== cueId) renderCue(cue);
  if (cue) {
    const index = activeWordIndex(wordsByCue.get(cue.id) ?? [], seconds);
    dom.caption.querySelectorAll(".word").forEach((span, position) => span.classList.toggle("is-active", position === index));
  }
  dom.scrubber.value = String(Math.round(seconds * 1000));
  dom.time.textContent = `${formatTime(seconds)} / ${formatTime(timeline.duration_seconds)}`;
}

function tick() {
  syncToTime(dom.audio.currentTime);
  if (!dom.audio.paused && !dom.audio.ended) rafHandle = requestAnimationFrame(tick);
}

function updatePlayLabel() {
  const labels = state.pack.labels;
  const playing = !dom.audio.paused && !dom.audio.ended;
  dom.play.textContent = playing ? labels["ui.pause"] : dom.audio.ended ? labels["ui.replay"] : labels["ui.play"];
  dom.play.setAttribute("aria-pressed", String(playing));
}

function renderLanguages(guide) {
  const available = availableLanguages(guide.index);
  dom.language.replaceChildren(...LANGUAGES.map((language) => {
    const option = document.createElement("option");
    option.value = language.code;
    option.disabled = !available.includes(language.code);
    option.textContent = option.disabled ? `${language.label} · ${guide.pack.labels["ui.coming"]}` : language.label;
    option.selected = language.code === guide.language;
    return option;
  }));
}

function navigate(params) {
  location.hash = buildFragment(params);
}

async function init() {
  cancelAnimationFrame(rafHandle);
  dom.audio.pause();
  const params = parseFragment(location.hash);
  const number = Number.parseInt(params.s ?? "1", 10) || 1;
  const guide = await loadGuide(params.l);
  const labels = guide.pack.labels;
  const segment = segmentByNumber(guide.segments, number) ?? guide.segments.segments[0];
  const picked = pickEntry(guide.index, segment.number, guide.language);
  if (!picked.entry) {
    setStatus([labels["ui.notice"], `No media is built for segment ${segment.number}.`]);
    return;
  }
  const timeline = await fetchJson(picked.entry.timeline);
  wordsByCue = assignWordsToCues(timeline);
  frameId = null;
  cueId = null;
  state = { ...guide, segment, timeline, entry: picked.entry, params };

  document.documentElement.lang = guide.pack.language;
  document.title = `${labels[segment.title_key]} · ${labels["guide.title"]}`;
  dom.titleStrip.replaceChildren(renderTitleCard(segment, guide.pack));
  dom.audio.src = assetUrl(picked.entry.audio);
  dom.audio.playbackRate = Number(dom.speed.value);
  dom.scrubber.max = String(Math.round(timeline.duration_seconds * 1000));
  dom.scrubber.setAttribute("aria-label", labels["ui.seek"]);
  dom.speedLabel.textContent = labels["ui.speed"];
  dom.subtitlesLabel.textContent = labels["ui.subtitles"];
  dom.languageLabel.textContent = labels["ui.language"];
  dom.transcriptSummary.textContent = labels["ui.transcript"];
  dom.prev.textContent = labels["ui.previous"];
  dom.next.textContent = labels["ui.next"];
  dom.contentsLink.textContent = labels["ui.contents"];
  dom.contentsLink.href = `index.html${buildFragment({ ...params, s: undefined })}`;
  renderLanguages(guide);

  const subtitlesOn = readPreference();
  dom.subtitles.checked = subtitlesOn;
  dom.captionBand.hidden = !subtitlesOn;

  const total = guide.segments.segments.length;
  dom.prev.disabled = segment.number <= 1;
  dom.next.disabled = segment.number >= total;

  dom.transcript.replaceChildren(...timeline.beats.map((beat) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = beat.text;
    return paragraph;
  }));

  const messages = [labels["ui.notice"]];
  if (picked.fallback || guide.packFallback) messages.push(labels["ui.language_fallback"]);
  if (pendingConditionalBeats(segment).length) messages.push(labels["ui.pending_clinician_text"]);
  setStatus(messages);

  syncToTime(0);
  updatePlayLabel();
  window.__guidePlayer = {
    getState: () => ({
      segment: segment.id,
      language: guide.language,
      duration: timeline.duration_seconds,
      currentTime: dom.audio.currentTime,
      frame: frameId,
      cue: cueId,
      subtitles: !dom.captionBand.hidden
    })
  };
}

function showError(error) {
  setStatus([error.message]);
}

dom.play.addEventListener("click", () => {
  if (dom.audio.paused || dom.audio.ended) dom.audio.play().catch(showError);
  else dom.audio.pause();
});
dom.audio.addEventListener("play", () => {
  updatePlayLabel();
  cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(tick);
});
dom.audio.addEventListener("pause", () => {
  updatePlayLabel();
  syncToTime(dom.audio.currentTime);
});
dom.audio.addEventListener("ended", () => {
  updatePlayLabel();
  syncToTime(state.timeline.duration_seconds);
});
dom.audio.addEventListener("seeked", () => syncToTime(dom.audio.currentTime));
dom.scrubber.addEventListener("input", () => {
  dom.audio.currentTime = Number(dom.scrubber.value) / 1000;
  syncToTime(dom.audio.currentTime);
});
dom.speed.addEventListener("change", () => {
  dom.audio.playbackRate = Number(dom.speed.value);
});
dom.subtitles.addEventListener("change", () => {
  dom.captionBand.hidden = !dom.subtitles.checked;
  writePreference(dom.subtitles.checked);
});
dom.language.addEventListener("change", () => navigate({ ...state.params, l: normalizeLanguage(dom.language.value) }));
dom.prev.addEventListener("click", () => navigate({ ...state.params, s: state.segment.number - 1 }));
dom.next.addEventListener("click", () => navigate({ ...state.params, s: state.segment.number + 1 }));
document.addEventListener("keydown", (event) => {
  if (!state || event.target.matches("input, select, textarea, button, summary")) return;
  if (event.key === " ") {
    event.preventDefault();
    dom.play.click();
  } else if (event.key === "ArrowRight") {
    dom.audio.currentTime = Math.min(state.timeline.duration_seconds, dom.audio.currentTime + SEEK_STEP_SECONDS);
  } else if (event.key === "ArrowLeft") {
    dom.audio.currentTime = Math.max(0, dom.audio.currentTime - SEEK_STEP_SECONDS);
  }
});
window.addEventListener("hashchange", () => init().catch(showError));
init().catch(showError);
```

- [x] **Step 5: Run the structure tests**

Run: `node --test tests/v2-guide-structure.test.mjs`
Expected: `# pass 3`

- [x] **Step 6: Verify in the browser**

With the same preview server as Task 4: open `http://localhost:4175/guide/watch.html#s=1&l=en`; no console errors; the title strip shows "01", the segment title, and the "Day 2" chip; the stage shows the title card at time 0; click Play, wait 3 seconds, `javascript_tool` reads `window.__guidePlayer.getState()` and shows `frame: "beat/dressing-off"`, a `cue` id, and a growing `currentTime`; the caption band shows "Two days after surgery, remove the head bandage." with one highlighted word; press Space to pause; drag the scrubber past the second beat's start and confirm the frame changes to the two-paths card; untick Subtitles and confirm the band is hidden; click Next and confirm the hash becomes `#s=2&l=en` and the status strip shows the pending-medication note; at the mobile preset confirm no horizontal overflow and that the caption band stays two lines tall. Take one desktop and one mobile screenshot.

- [x] **Step 7: Commit**

```bash
git add guide/watch.html guide/assets/player.js tests/v2-guide-structure.test.mjs
git commit -m "feat: add the v2 segment player

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Link the guide from the homepage and README, run the full check

**Files:**
- Modify: `index.html` (add the guide as direction 02 below the safety-card guide)
- Modify: `README.md` ("What to look at first" gains the guide)
- Modify: `docs/PROJECT_STATUS.md` ("What exists" and "Known gaps" reflect the player)

- [x] **Step 1: Add the homepage entry**

Insert after the existing `<li class="variation">` block in `index.html`:

```html
        <li class="variation">
          <div class="variation-copy"><span class="variation-number">02</span><h3>Segmented narrated guide</h3><p>Five short narrated videos with synchronized captions and a table of contents, built from the same clinical content. English today; Spanish and Mandarin are next.</p></div>
          <div class="variation-links"><a class="variation-link" href="guide/index.html">Open the segmented guide →</a></div>
        </li>
```

- [x] **Step 2: Update the README and status doc**

In `README.md`, replace the "What to look at first" item 3 with: `3. Open the segmented narrated guide at \`guide/index.html\`: five short videos with captions and a contents page, English only for now, driven by the segment data in \`content/segments/\`.`

In `docs/PROJECT_STATUS.md`, add to "What exists": `4. The v2 contents page and player under \`guide/\`, which play the five English segments with synchronized captions, a language selector, a subtitle toggle, and a live-text transcript.` Replace "Known gaps" item 1 with: `### 1. Diagrams, languages, and the provider file are not built yet` and the paragraph `Slices 3 through 7 add anatomy diagrams with vector overlays, Spanish and Mandarin, the provider file, AI reviewers with labeled receipts, and file export. The player currently shows the deterministic SVG cards and live-text fallbacks.` Change "Best next contributions" item 1 to `1. Build v2 slice 3: anatomy masters with deterministic overlays, through the image loop.`

- [x] **Step 3: Run the full check**

Run: `npm run check 2>&1 | tail -12`
Expected: `frames valid: 10 frames cover every beat`, the segment and translation lines, and `# pass 49` with `# fail 0` (39 from the retirement baseline plus 2 frames, 1 label, 4 logic, and 3 structure tests).

- [x] **Step 4: Commit**

```bash
git add index.html README.md docs/PROJECT_STATUS.md
git commit -m "docs: link the segmented guide from the homepage and status

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** section 4 (canvas zones, player controls, captions from timestamps with active word, keyboard, reduced motion, TOC as the card with thumbnails and durations, language selector, subtitle toggle, printable card link, status strip with badges and notice) is Tasks 4 and 5; section 6's fallback-to-English notice is Task 4's `loadGuide` plus both pages' status; section 8's badge rendering from `content/reviews/index.json` is Task 4; section 11's `guide/` layout matches; section 12 steps 4 and 5 (player loads model, frames, pack, audio, captions; fragment carries language and later parameters) are Tasks 3 to 5; section 13's missing translation, missing receipts, and pending medication beats are handled in Tasks 4 and 5; section 14's structure tests and browser checks are Tasks 4 to 6. Section 4's provider page and section 7 are slice 5; anatomy overlays are slice 3.
- **Placeholders:** none; every file's full content is in its task.
- **Type consistency:** `loadGuide` returns `{ language, segments, canonical, index, frames, pack, packFallback, sentences, reviews }` and both pages read exactly those keys; `pickEntry` returns `{ entry, fallback }` in Tasks 3, 4, 5; `renderFrame(frame, { beat, sentences, pack })` and `renderTitleCard(segment, pack)` match between Task 4's module and Task 5's calls; the label keys added in Task 2 are the ones read in Tasks 4 and 5.

## Execution notes (2026-09-17)

- Tasks 4 and 5 were committed together so that no intermediate commit carries a failing structure test.
- Two fixes surfaced in browser verification and are in the committed code: language controls shrink on narrow screens (16 px overflow at 375 px), and a favicon suppressor stops a stray 404 on both pages.
- The Space shortcut accepts `key`, `code`, and the legacy `Spacebar` value; the desktop browser automation cannot synthesize a Space key event, so that path was verified by inspection and by the working ArrowRight path.
- Seeking was verified against `scripts/serve.mjs`, which supports byte ranges; Python's `http.server` does not, and cannot seek media.
