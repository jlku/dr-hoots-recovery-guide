# AVS v2: segmented, narrated, multilingual recovery guide with a provider file

Status: design approved in conversation by John on 2026-09-17; written spec pending John's review.
Scope: private prototype. Nothing here is patient-ready, clinically approved, or an official UCSF resource.

## 1. Why this version exists

Song (clinician partner) reviewed the 2:17 Dr. Hoots guide on 2026-09-17 and asked for, in order:

1. ~30-second videos instead of one 2.5-minute video.
2. No owl. Generated diagrams of the surgical site and anatomy.
3. A narrator voice instead of a character talking at the viewer.
4. Subtitles.
5. A selectable table of contents. The card is the general summary; the videos are the fine detail.
6. A language selector: Mandarin and Spanish.
7. A provider editing surface shaped like his dot phrase, with columns for antibiotic yes/no, pain medication yes/no, follow-up date, and "reviewed this video, date". Presets on every column, each overridable. He works in a text file today.

Kept out on purpose: the timing track (videos tied to the post-operative day). It is a delivery model, not a format fix, and it waits on Song's call and ED data. Segments carry day labels anyway because the canonical values already do.

John's additions (2026-09-17): use the UCSF-derived design system as the basis; draft the dot phrase from UCSF documentation and present it as an educated ask; spend cap $10; AI reviewer subagents for Spanish, Mandarin, and a simulated Song review, all labeled as AI in the UI; segment 2 carries the per-patient slot.

## 2. Decisions already made

- **Web-first.** One static page lists five clips with a TOC, language selector, and subtitle tracks. MP4 export comes last, small, and only for the fixed shared segments in 9:16.
- **Two clocks that never touch.** Content production is gated and may be slow; it happens once per version, offline. The point of care and patient playback never call a generative model or wait on a gate.
- **No generated video anywhere.** Dropping the owl removes image-to-video, avatar, and lipsync. Generation is TTS plus a handful of still images.
- **Build on the draft layer.** Segment data derives from `preview/assets/frames.js`, `preview/assets/guide-data.js`, and the draft audio. The frozen activation pipeline under `scripts/lib/production-run.mjs` and `.production/` stays untouched.
- **Stack.** Vanilla ES modules, JSON, `node:test`, served by the existing `scripts/serve.mjs`. No framework. Playwright arrives later as a dev dependency for export and browser tests only.
- **Existing rules still apply.** Clinical meaning lives in `content/canonical/`; formats may change pacing, grouping, and presentation but never propositions; every surface stays `patient_use: false`; AI review is never described as clinical approval.

## 3. Segments

Cut on the patient's question, not on module boundaries. Durations are from the recorded English narration.

| # | Segment id | Title | Day chip | Canonical sentences | Spoken target |
|---|---|---|---|---|---|
| 1 | `seg/incision-day2` | Day 2: bandage off, tape or no tape | Day 2 | wc.01 to wc.07 | about 28 s |
| 2 | `seg/next-two-weeks` | The next two weeks: shower, your medicines, your wound check | Day 3 to 2 weeks | wc.08 to wc.10 plus the medication slot | about 25 s |
| 3 | `seg/when-to-call` | When to call: the signs | Any day | call.01 to call.05 | about 28 s |
| 4 | `seg/who-to-call` | Who to call: the numbers | Any day | call.06 to call.08 | about 22 s |
| 5 | `seg/programming-visits` | After healing: programming visits | After healing | act.01 to act.05 | about 26 s |

> **Revised 2026-09-19: seven segments.** Spanish and Mandarin narration ran over the ceiling in segments 1 and 3 (Spanish about 40 s each, Mandarin 37.8 s and 48.6 s): the translated text is 30 to 40 percent longer, and the English-origin voices speak Mandarin slowly. John chose to split both, in every language, so chapter numbers mean the same thing in every language. Segment 1 became `seg/bandage-off` (wc.01, wc.02) and `seg/tape-or-no-tape` (wc.03 to wc.07); segment 3 became `seg/call-all-three` (call.01 to call.01c) and `seg/call-any-one` (call.02 to call.05). The medication segment is now number 3; the fixed, exportable segments are 1, 2, and 4 to 7. Each beat keeps its recorded narration, so the split needed no new speech.

Rules:

- Hard ceiling 35 s of narration per segment, checked by a validator against the timestamp manifest.
- Each segment opens on a 1.5 s title card: number, title, day chip. No welcome clip, no outro. The TOC page does the welcoming.
- A segment is a list of beats. A beat binds one or more sentence IDs to one frame and one motion. Beats are the unit that captions, motion, and translations all key on.
- Segment 2 owns the per-patient slot and the follow-up date. See section 7.

File: `content/segments/ci-phase0-v0.1.0.segments.json`. Schema: `schema_version`, `artifact_id`, `artifact_version`, `status`, `patient_use: false`, `canvas {width: 1080, height: 1920, fps: 30}`, `segments[]` with `id`, `number`, `title_key`, `day_chip_key`, `sentence_ids[]`, `beats[] {id, sentence_ids[], frame, motion}`, optional `variants`, optional `data_fields[]`.

## 4. Canvas, player, and TOC

**Canvas.** One 9:16 timeline at 1080 by 1920 serves phones, the web player, and the later export. Zones from top: title strip (segment number, title, day chip), a square diagram stage, and a fixed two-line caption band in large type. Post-implant patients read before they hear, so the caption band never moves and never shrinks. Social safe zones are respected so the same composition exports without re-layout.

**Design basis.** Tokens come from `design-system.html`: navy `#052049`, blue `#0071ad`, teal `#14828c`, yellow `#feb80a`, Helvetica Neue, paper background, and its section 04 grammar: numbered frame, action arrow, detail inset, do-not slash, consistent figure, sequence readable without motion. Where `index.html` and `tiktok-video.html` use slightly different hex values, the design-system values win.

**Player** (`guide/watch.html`). Plays one segment, with previous and next, play and pause, scrubber, elapsed and total time, playback speed, a subtitle toggle, and the language selector. Captions are live HTML text driven by the narration timestamps, with the active word highlighted, the same mechanism the current guide uses. Keyboard operable, visible focus, reduced motion honored by rendering beats as static states.

**TOC page** (`guide/index.html`). This is the card. Each segment appears as a numbered thumbnail of its key frame with title, day chip, and duration. The language selector and subtitle toggle sit above the list. The printable pamphlet PDF is linked as the summary. A status strip at the bottom shows the review badges from section 8 and the standing "private prototype, not for patient use" notice. Selecting a segment opens the player; the player's next and previous walk the same order.

**Provider page** (`guide/provider.html`). A single textarea. The provider pastes the dot-phrase block from their own text file. The page shows the parsed fields as a small table, flags any line it could not read, applies presets for missing lines, and produces the patient link. Nothing is stored server side. The Notion-style editable table is a later version that reads and writes this same text.

## 5. Diagrams

Three generated anatomy masters, each grounded in `evals/safety-cards/medical-reference-packet.md` and the two user references already in `evals/safety-cards/references/`:

1. Behind-ear region: dressing on, dressing off, tape present, tape absent. Used by segment 1.
2. Incision area at rest, red and swollen, and with fluid under the skin. Used by segment 3.
3. External processor beside the ear at the programming visit. Used by segment 5.

Rules:

- Masters are generated with FLUX.2 pro edit from the references. State variants are controlled edits of the master, never independent redraws.
- Every clinical mark stays deterministic vector on top: tape rectangle, prohibition slash, arrows, calendar marks, the thermometer value, phone numbers, all captions. Generated art carries no text and no clinical mark.
- Motion is SVG reveals and pans synced to narration timestamps, using the per-frame `videoMotion` notes already in `preview/assets/frames.js`.
- Each frame keeps its existing SVG card from `preview/assets/cards/` as the fallback and as the reduced-motion state. The prototype runs end to end on those cards before any image spend.
- Anatomy masters go through the image loop in `docs/IMAGE_EVAL_LOOP.md` once per master. State edits inherit the master's observation receipts and get a lighter diff check. The clinical gate for these frames is Song's review line in the provider file, recorded as a receipt.

## 6. Languages

- English canonical stays the single clinical source.
- Spanish (`es`) and Mandarin in Simplified Chinese script (`zh-Hans`) are translation records at `content/translations/<lang>/ci-phase0-v0.1.0.json`: `language`, `script`, `artifact_id`, `artifact_version`, `status` (`machine_draft`, `ai_reviewed`, `human_reviewed`), `sentences {id: text}`, `labels {key: text}` for titles, chips, and on-frame labels, and `review {kind, label, date, receipt}`.
- Validator: every canonical sentence ID present; every label key present; every protected value present in the translated sentence: phone numbers verbatim, numerals present with locale decimal separators allowed, the fever comparator preserved. Missing or altered protected values fail the build.
- Narration per language through the same ElevenLabs v3 model with the language code set. One short voice test per language before committing to a narrator, because the current voice may not sound native in Mandarin.
- Subtitles per segment per language as WebVTT derived from character timestamps, the same derivation the activation slice already does, generalized to segments.
- The patient link carries the language. The provider file can set it. The player falls back to English with a visible notice when a language asset is missing.
- Traditional Chinese script is a later addition, not part of this version.

## 7. Provider file, presets, and the dot-phrase draft

**Format.** A dot-phrase-shaped block that can live inside the text file the provider already uses. Lines are `Key: value`. A missing line means the preset. A present line overrides it. Reading is tolerant: `yes`, `y`, `no`, `n`, and Epic-style `{Yes/No}` remnants all parse; dates accept ISO and US formats and normalize to ISO; unknown lines are ignored and listed.

**Draft dot phrase, assembled from UCSF documentation.** This is the educated ask for Song. Lines marked (UCSF CI Center) come from the canonical source already in the repo. Lines marked (UCSF EARS) come from the EARS program page and need his confirmation. Lines marked (peer) mirror other institutions' sheets and are placeholders for his own wording.

```text
.CIPOSTOP  Cochlear implant post-operative instructions (UCSF OHNS)
Surgery date: ***          Side: {Left/Right}          Surgeon: ***
Dressing: remove the head (mastoid) dressing 2 days after surgery.            (UCSF CI Center)
Incision: {Tape present: keep dry 3 days, no cleaning / No tape: clean edges 2x daily
  with 50/50 hydrogen peroxide and distilled water, then bacitracin}           (UCSF CI Center)
Shower: may shower and wash hair 3 days after surgery.                        (UCSF CI Center)
Antibiotic: {Yes: *** name, dose, days / No}                                   (UCSF EARS: "as prescribed")
Pain medication: {Yes: *** / No: acetaminophen as needed}                      (UCSF EARS: Rx first 48-72 h, then OTC)
Avoid: aspirin, ibuprofen, other NSAIDs for *** days                          (peer sheets: 10 days; confirm)
Activity: no lifting over *** lb for *** weeks; no swimming until cleared;
  avoid nose blowing; no driving until cleared                                 (UCSF EARS: >10 lb, 2-3 weeks)
Follow-up: wound check and ear exam on ***                                     (UCSF CI Center: about 2 weeks;
                                                                                UCSF EARS: 7-10 days; timeline PDF: 2-3 weeks)
Activation: with audiology, about *** weeks after surgery                      (CI Center: about 1 month;
                                                                                timeline PDF: 2-3 weeks; EARS: 3-6 weeks)
When to call: redness and swelling not improving over 1-2 days and painful to touch;
  fever above 101.5 F; swelling or fluid behind the ear; headache, light sensitivity,
  or excessive lethargy; any wound-care question or concern.                   (UCSF CI Center)
Contact: nursing line 415-353-2148, callback within 12 hours, call again if none;
  emergencies 415-476-1000, ask for the Otolaryngology resident on call.       (UCSF CI Center)
Video guide: language {English/Spanish/Mandarin}    Reviewed by *** on ***
```

**What the product reads from it.** Only these lines drive the guide: `Antibiotic`, `Pain medication`, `Follow-up`, `Video guide` language, and `Reviewed by`. Everything else stays in his note as usual. The parser returns `{antibiotic: boolean, pain_medication: boolean, follow_up_date: ISO date, language: en | es | zh-Hans, reviewed: {by, date} | null}` plus a list of unread lines.

**Presets** live in `content/provider/presets.json` and ship as placeholders Song should confirm: antibiotic yes, pain medication yes, language English, follow-up date empty. An empty follow-up date renders the canonical "about two weeks" wording instead of a date.

**Segment 2 behavior.**
- The follow-up date is a data field. It is drawn as live text by the deterministic layer. It never passes through TTS, so it needs no generative gate.
- Antibiotic yes and pain medication yes add a medication beat each. Their wording is drafted from the UCSF EARS page as an evidence draft in a new canonical module `ci/medications` with `status: surgeon_review`, because medication instructions are a mandatory surgeon-review trigger in `docs/EVALUATION_GATES.md`.
- Antibiotic no and pain medication no have no source anywhere. Until Song supplies wording, those cases omit the beat and the segment simply runs shorter. The player shows a small "pending clinician text" note in the status strip, never inside the patient reading flow.
- Variants are therefore pre-rendered combinations of present beats, not free text.

**Patient link.** `guide/index.html#a=1&p=0&f=2026-10-01&l=es&r=2026-09-17` with parameters in the URL fragment so nothing patient-specific reaches server logs. No names, no record numbers. The date is the only patient-specific value and it is a clinic appointment date.

**Asks for Song**, surfaced on the provider page as a short checklist: mark up the draft block; confirm the presets; pick the follow-up interval and activation window his practice uses; supply the no-antibiotic and no-pain-medication wording; say whether activity restrictions deserve a sixth segment; name the anatomy views patients ask about most.

## 8. Reviewers and receipts

Three AI reviewers, each a persona file plus a rubric, run as subagents by an operator and recorded as immutable receipts. They live in a tracked directory because `.gitignore` excludes `.claude/` and `evals/`.

```text
reviewers/
  es/persona.md    rubric.json
  zh/persona.md    rubric.json
  song/persona.md  rubric.json
content/reviews/<reviewer>/<target-hash>.json   receipts, tracked
```

- **Spanish reviewer** and **Mandarin reviewer** check a translation record against the English canonical: clinical equivalence sentence by sentence, protected values, register at grade 7 or below, and natural phrasing for Bay Area speakers. They output a receipt with findings, a pass or fail per sentence ID, and the label `AI reviewer (Claude), not a certified medical translator`.
- **Song reviewer** checks a build against his seven requirements plus workflow fit: the provider can go from pasting a dot-phrase block to a patient link in under a minute with no account and no new app; the columns match his spec; the review line is one line; every segment is 35 s or less; no owl; narrator voice; subtitles present in all three languages; TOC selectable; language switch works; the card summary is reachable. Every check must pass. The receipt label is `Simulated Song review (AI), not Song's approval`.
- `scripts/review-packet.mjs <reviewer> <target>` emits the packet: file list, hashes, rubric, and the canonical text. `scripts/review-record.mjs <receipt.json>` validates and stores it: hash binding to the exact target, rubric coverage, reviewer kind `ai`, a required label, and no reuse of a receipt across hashes.
- The TOC status strip reads `content/reviews/index.json` and shows one badge per reviewer with its label and date. Missing receipts show "not yet reviewed". A real review by Song is recorded through the provider file's `Reviewed by` line and shows as a separate badge, `Reviewed by clinician`, with the date.

## 9. Gates and latency

Gate by artifact class:

| Artifact | Gate |
|---|---|
| Live text, numbers, phone routes, vector diagrams | Automated validators, plus the clinician review line |
| Generated anatomy masters | Full image loop once per master; edits inherit with a diff check |
| Narration tracks | Automated text match and timestamp completeness |
| Translations | Validator plus the AI language reviewer per version; human reviewer before any patient use |
| Whole build | Simulated Song review, all checks passing |

Latency targets the design is held to:

| Moment | Target |
|---|---|
| Provider pastes the block and gets a patient link | under 5 s, no network calls |
| Patient opens the link and the first clip plays | under 2 s from static hosting |
| One wording edit to a reviewable browser draft | under 5 min |
| Approved version to all export files rendered and verified | under 30 min with parallel workers |
| New language | about 1 build day plus review |

Human gates batch per version, not per scene. The browser preview precedes any render. Rebuilds are incremental by input hash, the pattern the editor and the derivative bundle already use.

## 10. Spend

Cap $10, authorized by John on 2026-09-17. Ledger at `content/spend/v2-ledger.json` with one entry per provider request: model, unit count, estimate, actual, request ID, purpose. Estimates use the rates in `scripts/lib/editor-generation-service.mjs` and fal's published FLUX.2 pro edit rate.

| Purpose | Estimate |
|---|---|
| Voice tests, one short track per language | $0.05 |
| English re-records for changed lines and medication beats | $0.15 |
| Spanish and Mandarin narration, two rounds | $0.60 |
| Three anatomy masters with edits and retries | $1.00 to $2.00 |
| Reserve | remainder |

The prototype runs at $0 on existing English audio and SVG cards. Every paid request logs to the ledger first and refuses to run past the cap.

## 11. File layout

```text
guide/index.html                 TOC, language selector, subtitle toggle, review badges
guide/watch.html                 player
guide/provider.html              paste block, parsed table, patient link, asks for Song
guide/assets/guide.css           tokens from design-system.html
guide/assets/player.js           playback, captions, language, fragment parameters
guide/assets/timeline.js         beat and motion driver over SVG frames
guide/assets/frames/             SVG frames and anatomy stills with manifest
content/segments/ci-phase0-v0.1.0.segments.json
content/canonical/ci-phase0-v0.1.0.json      gains module ci/medications, status surgeon_review
content/translations/es/… and zh-Hans/…
content/provider/presets.json
content/reviews/…                 receipts and index
content/spend/v2-ledger.json
assets/audio/v2/<lang>/…          narration and timestamp manifest
assets/captions/v2/<lang>/…       WebVTT per segment
reviewers/{es,zh,song}/           persona.md, rubric.json
scripts/validate-segments.mjs, validate-translations.mjs, build-captions.mjs,
scripts/provider-link.mjs, review-packet.mjs, review-record.mjs, generate-v2-narration.mjs
tests/v2-*.test.mjs
```

`npm run check` gains the two validators and the new tests. The existing checks keep running unchanged.

## 12. Data flow

1. Canonical English plus translation records feed the segment model. Validators run.
2. Narration is generated per language per segment and per present medication beat, with timestamps. The ledger gates spend.
3. Captions are derived per segment per language from timestamps.
4. The player loads the segment model, the frame manifest, the language pack, the audio, and the captions, and renders beats in the browser with live captions.
5. The provider page parses a pasted block into parameters and writes them into the fragment of the patient link. The player reads the fragment to choose language, variant beats, and the follow-up date.
6. Reviewers read packets and write receipts. The TOC reads the receipt index for badges.
7. Later: Playwright captures `guide/watch.html?export=1` per fixed segment and language, ffmpeg muxes audio and burns captions, and files land in object storage with a promotion pointer.

## 13. Error handling

- Missing translation asset: play English with a visible notice, never silently.
- Missing or mismatched audio: captions-only playback with paced timing, the existing fallback, plus a status note.
- Unreadable provider lines: list them, apply presets, never guess a yes or no.
- Missing variant beat wording: omit the beat, show the pending note in the status strip.
- Missing receipts: badge reads "not yet reviewed".
- Ledger at cap: generation refuses with the amount that would exceed it.
- Timestamps that do not cover the narration text: build fails, the same rule the derivative bundle enforces today.

## 14. Testing

- `node:test` for: segment validation (ID coverage, order, the 35 s ceiling from timestamps), translation validation (coverage, protected values, decimal handling), VTT derivation per segment, the provider parser across tolerant inputs, link building (fragment only), presets and overrides, receipt validation (hash binding, rubric coverage, label, no reuse), ledger cap behavior.
- Structure tests for the three HTML pages in the style of `tests/editor-structure.test.mjs`: required controls, the notice, no raw prompt fields, no production IDs in patient-facing text.
- Browser verification in the desktop preview at desktop width and 390 px: playback, caption timing, language switch, subtitle toggle, keyboard traversal, reduced motion.
- Acceptance: the Song reviewer run passes every check on the exact build hash, and its receipt is recorded.

## 15. Out of scope for this version

Timing track and day-based delivery; the full MP4 matrix beyond fixed segments in 9:16; the Notion-style editable table; Traditional Chinese; the owl in any form; human clinical or institutional approval; patient use.

## 16. Sources consulted for section 7

- UCSF Cochlear Implant Center, surgery and post-operative care: https://ohns.ucsf.edu/otology-neurotology/cochlear-implant-center/surgery
- UCSF Cochlear Implant Center, activation: https://ohns.ucsf.edu/otology-neurotology/cochlear-implant-center/activation
- UCSF Cochlear Implant Center, emergency contact: https://ohns.ucsf.edu/otology-neurotology/cochlear-implant-center/emergency-contact
- UCSF timeline of appointments (PDF): https://ohns.ucsf.edu/sites/ohns.ucsf.edu/files/2023-11/Cochlear%20Implant%20Timeline.pdf
- UCSF EARS program, cochlear implant surgery, what to expect: https://ears.ucsf.edu/en/devices/ci-surgery-what-to-expect
- Washington University Otolaryngology, post-operative care following cochlear implantation (structure reference only): https://oto.wustl.edu/app/uploads/2020/04/Post-op-Cochlear-Implant.pdf
