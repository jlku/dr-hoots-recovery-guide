# AVS v2 Slice 6: Simulated Song Review, Receipts, and Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A simulated Song reviewer checks the whole build against the seven things Song asked for on 2026-09-17 plus workflow fit, from evidence captured from the running build, and its receipt binds to the exact build. The guide shows who reviewed what: the translation reviewers, the simulated Song review, and Song's own review line from the provider's link.

**Architecture:** A build hash covers every tracked file the guide and the provider page serve, except receipts and the ledger. An evidence script drives the installed Chrome through `playwright-core`, captures screenshots at desktop and phone widths in all three languages plus the provider flow, and measures the facts code can measure. A packet gives the reviewer Song's requirements, the rubric, the measured facts, and the screenshot paths. Three independent reviewer subagents each write a receipt; code refuses a receipt that passes a check whose measured fact failed, and the build counts as reviewed only when all three pass the current build hash. `content/reviews/index.json` gains a badge list the guide reads.

**Tech Stack:** Vanilla ES modules, JSON, `node:test`, `playwright-core` driving the installed Google Chrome (dev dependency; no browser download).

**Spec:** `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md`, sections 1, 4 (status strip), 8 (Reviewers and receipts), 9, 13 (missing receipts), 14 (acceptance).

## Global Constraints

- Receipt label, exactly: `Simulated Song review (AI), not Song's approval`. Reviewer kind `ai`. Never described as Song's approval or clinical approval anywhere.
- Every check must pass for the build to pass. A check whose measured fact failed cannot pass.
- Three independent reviewers per build hash (`PANEL_SIZE`, shared with the language reviewers), none seeing another's receipt. Receipts are never replaced: `content/reviews/song/<hash16>.json`, `.2.json`, `.3.json`.
- The build hash excludes `content/reviews/` and `content/spend/`, so recording a receipt or a spend entry does not change it.
- Missing, failing, incomplete, or stale reviews show "not yet reviewed". Song's real review comes only from the provider's `Reviewed by` line (`r` in the link) and shows as a separate badge, `Reviewed by clinician`, with the date.
- Badges help the reader know what was checked and by whom. No eyebrows, no subheads, no decoration. On desktop they sit in the rail footer with the prototype notice; on phones they sit at the end of the transcript with the print link and the notice, which phones did not show before.
- `patient_use: false` everywhere. No paid calls in this slice.

## The checks

Song's seven requirements (spec section 1) plus the workflow fit spec section 8 names. `measured` means code measures a fact the reviewer cannot overrule.

| id | Song asked for | Passes when | measured |
| --- | --- | --- | --- |
| `short_clips` | ~30-second videos | every segment in every narrated language is 35 s or less | yes |
| `no_owl` | no owl; diagrams of the site | no owl on any patient-facing surface; the pictures are anatomy diagrams | owl search |
| `narrator` | a narrator, not a character | one narrator voice per language speaks about the patient in second person, no character | voices |
| `subtitles` | subtitles | captions exist for every segment in English, Spanish, and Mandarin | yes |
| `toc` | a selectable table of contents | every chapter is listed and choosing one plays from its start | yes |
| `languages` | Mandarin and Spanish | switching language changes the page, audio, and captions | yes |
| `provider_file` | a table shaped like his dot phrase | pasting the block gives a patient link in under a minute, with no account and no new app; the table shows antibiotic, pain medication, follow-up date, and reviewed-by with date, each with a preset and an override | yes |
| `review_line` | "reviewed this video, date" | the review line is one line in the block, and it reaches the guide as the clinician badge | yes |
| `card_summary` | the card is the general summary | the printable card is one tap away at desktop and phone widths | yes |

## File Structure

| File | Responsibility |
| --- | --- |
| `reviewers/song/persona.md`, `reviewers/song/rubric.json` | The simulated reviewer and its checks |
| `scripts/lib/build-hash.mjs` | The build hash over served, tracked files |
| `scripts/lib/song-review.mjs` | Packet, receipt validation, panel rules, receipt paths |
| `scripts/song-evidence.mjs` | Drives Chrome, writes facts and screenshots to an evidence directory |
| `scripts/review-packet.mjs`, `scripts/review-record.mjs` | Accept reviewer `song` |
| `scripts/lib/reviews-index.mjs` | Builds `content/reviews/index.json`, badges included; used by the evaluator and by the check |
| `scripts/validate-reviews.mjs` | Fails when the index is stale |
| `guide/assets/logic.js` | `reviewBadges(...)`; `statusMessages` keeps only warnings |
| `guide/index.html`, `guide/assets/guide.js`, `guide/assets/guide.css` | Badge list; phone footer with the print link and notice |
| `content/translations/*` | New labels |
| `content/provider/dot-phrase-draft.txt` | The draft block from spec section 7, as a file the evidence script pastes |

---

### Task 1: The build hash

**Files:** Create `scripts/lib/build-hash.mjs`; test `tests/v2-song-review.test.mjs`.

**Interfaces:** `BUILD_PATHS` (prefixes), `BUILD_EXCLUDED` (prefixes), `buildFiles(root) -> string[]` from `git ls-files` filtered by prefix, `buildHash(root) -> { sha256, files }` over `path\0sha256(contents)\n` lines in sorted order, reading the working tree.

Prefixes: `guide/`, `content/`, `assets/audio/v2/`, `assets/captions/v2/`, `assets/anatomy/`, `output/pdf/airline-safety-card-deck-prototype.pdf`, `reviewers/song/`. Excluded: `content/reviews/`, `content/spend/`.

- [ ] Test: the hash is stable across two calls, lists no excluded file, and changes when a served file's bytes change (write a temp copy of the repo subset with a changed `guide/assets/guide.css`; or pass an injectable `read` and `list` to a pure `hashFiles(entries)`, and test that).
- [ ] Implement, run, commit `feat: a build hash over every file the guide serves`.

### Task 2: The Song reviewer, packet, and receipts

**Files:** Create `reviewers/song/persona.md`, `reviewers/song/rubric.json`, `scripts/lib/song-review.mjs`; modify `scripts/review-packet.mjs`, `scripts/review-record.mjs`, `scripts/lib/adjudication.mjs` (`validateReviews` covers `content/reviews/song/`); test `tests/v2-song-review.test.mjs`.

**Interfaces:**
- `SONG_LABEL = "Simulated Song review (AI), not Song's approval"`.
- `buildSongPacket({ root, evidence }) -> { reviewer: "song", persona, target: { kind: "build", sha256, files }, rubric: { id, sha256, checks }, requirements, facts, screenshots: [{ path, sha256, shows }], receipt_format }`. `evidence` is the parsed `facts.json` from the evidence directory; the packet refuses evidence captured for a different build hash.
- `validateSongReceipt(receipt, packet) -> string[]`: reviewer, kind, label, model, date, target binding, rubric binding, every check present with `pass|fail` and a note, no pass on a check whose measured fact failed, verdict `pass` only when every check passes, a finding for every failing check.
- `songReceiptPath(hash, member)`, `songPanelPaths(hash)`, `songPanelErrors(receipts, packet)`.

Persona: simulates Song, a cochlear implant surgeon who asked for these seven things, who works from a text-file dot phrase in Epic, who has no time for a new app or account, and who judges from what a patient and a provider would actually see in the screenshots. It reads only the packet and the screenshots it lists. It is not Song.

- [ ] Test the receipt rules with a synthetic packet and receipts (pass; wrong hash; missing check; pass over a failed measured fact; verdict rule; panel of three).
- [ ] Implement; `review-packet.mjs song --evidence <dir> --out <file>`; `review-record.mjs` dispatches on `receipt.reviewer === "song"` to the song rules and slots.
- [ ] Commit `feat: a simulated Song reviewer whose receipt binds to the build`.

### Task 3: Evidence from the running build

**Files:** Create `scripts/song-evidence.mjs`, `content/provider/dot-phrase-draft.txt`; modify `package.json` (dev dependency `playwright-core`, script `review:song-evidence`).

The script starts `scripts/serve.mjs` on a free port in a child process, launches Chrome with `chromium.launch({ channel: "chrome" })`, and writes `facts.json` plus PNGs to `--out <dir>` (outside the repository). Facts:

- `build`: `buildHash(root)`.
- `short_clips`: per language and segment, the timeline duration; `max_seconds`; `ok` when every value is 35 or less and every narrated language has all five segments.
- `no_owl`: files under the build that match `/\bowl\b|hoots/i` in patient-facing text (guide HTML and JS, packs, frames, anatomy manifest); `ok` when none.
- `narrator`: `assets/audio/v2/voices.json` per language (voice or null) and whether each language is narrated; `ok` when every language has a chosen voice and narration.
- `subtitles`: per language, the segments whose captions exist in the media index; `ok` when all three languages have all five.
- `toc`: at desktop, choose each chapter from the rail and record the player's global time and the active chapter; `ok` when each lands at its chapter start (within 0.5 s).
- `languages`: for `es` and `zh-Hans`, the document `lang`, the title, the audio source language, and the first caption cue; `ok` when all match the language (English audio counts as not ok).
- `provider_file`: paste `dot-phrase-draft.txt` into the provider page, record the parsed rows (label, value, source), unread lines, the link, and milliseconds from paste to link; count network requests after load other than the presets file; `ok` when the four columns appear, the link exists, time is under 60 000 ms, and there are no other requests.
- `review_line`: the draft's lines matching `/reviewed by/i`; `ok` when exactly one; then open the produced link with `r` set and record the clinician badge text.
- `card_summary`: at 1280×800 and 375×812, whether an element linking to the card PDF is visible without opening a menu, and whether the PDF responds 200; `ok` when both widths show it.

Screenshots: guide desktop and phone in en, es, zh-Hans at chapter 1; the provider page after paste; the guide opened from the provider link. Each with a `shows` sentence.

- [ ] Run it against the current build; expect `card_summary.ok` false at 375 (phones hide the print link), and `subtitles`, `narrator`, `languages` false until Spanish and Mandarin are narrated.
- [ ] Commit `feat: capture evidence from the running build for the Song review`.

### Task 4: The reviews index carries badges

**Files:** Create `scripts/lib/reviews-index.mjs`; modify `scripts/lib/review-runner.mjs` (`refreshReviewsIndex` uses it), `scripts/validate-reviews.mjs` (stale index fails, with the command to rebuild), `package.json` (`reviews:index`); test `tests/v2-reviews-index.test.mjs`.

**Interfaces:** `buildReviewsIndex(root) -> { schema_version, patient_use: false, anatomy: [...], badges: { translations: { es: badge, "zh-Hans": badge }, song: badge } }`, where `badge = { status: "reviewed" | "not_reviewed", label, date, target, receipts }`. A translation badge is `reviewed` when the pack's current hash has a full passing panel; the Song badge when the current build hash has one.

- [ ] Test with fixtures: full passing panel gives `reviewed`; two of three, a failing member, or a stale hash give `not_reviewed`.
- [ ] Commit `feat: the reviews index says which reviews cover the current build`.

### Task 5: Badges in the guide, and the card and notice on phones

**Files:** Modify `guide/assets/logic.js`, `guide/assets/guide.js`, `guide/index.html`, `guide/assets/guide.css`, the three packs (new labels); tests `tests/v2-guide-logic.test.mjs`, the guide structure test.

**Interfaces:** `reviewBadges({ badges, language, packReview, clinicianDate, labels }) -> [{ kind, text }]`: the translation badge for a non-English pack (its localized label and date, or "not yet reviewed"), the Song badge (its label and date, or "not yet reviewed"), and the clinician badge when `r` is a valid date. `statusMessages` keeps the fallback, the pending note, and the machine-draft label; a reviewed pack's label moves to the badges.

New labels: `ui.song_review` = "Simulated Song review (AI), not Song's approval", `ui.not_yet_reviewed` = "not yet reviewed", `ui.reviewed_by_clinician` = "Reviewed by clinician", `ui.translation_review` = "Translation". English text as given; Spanish and Mandarin drafted, then reviewed in Task 6.

- [ ] Tests for `reviewBadges` and the changed `statusMessages`.
- [ ] Markup: `<ul id="badges-rail" class="badges">` after the notice in the call block; a `<footer id="phone-footer" class="phone-footer">` at the end of the transcript pane with the print link, the notice, and `<ul id="badges-phone" class="badges">`; the phone footer shows only below the phone breakpoint.
- [ ] Browser check at 1280×800 and 375×812 in all three languages, with and without `r`; no horizontal scroll.
- [ ] Commit `feat: the guide shows who reviewed what, and phones reach the card`.

### Task 6: Translate the new labels and review both packs

Draft the four labels in Spanish and Mandarin; rebuild both packets; dispatch three independent reviewers per language in parallel; record every receipt; fix every finding and sweep for the same kind of problem; repeat until a full panel passes or three panels fail, then report.

### Task 7: Run the Song review

- [ ] Run the evidence script; build the packet; dispatch three independent reviewers in parallel with only the packet and its screenshots; record every receipt.
- [ ] Fix what the build can fix now (for example the phone card link) and repeat on the new build hash. Checks that wait on Spanish and Mandarin narration stay failing, honestly recorded, until John picks the voices.
- [ ] Rebuild the index; commit receipts and index.

### Task 8: Record the slice

Update `docs/PROJECT_STATUS.md`; run `npm run check`; commit `docs: record slice 6`.
