# Project status and handoff

Last updated: September 18, 2026

## Readiness verdict

| Use | Status | Why |
| --- | --- | --- |
| Share with a designer or developer for critique and iteration | **Ready, with this document attached** | The project runs locally, the architecture is documented, and deterministic checks pass. |
| Treat as a finished design direction | **Not ready** | The v2 segmented guide is being built slice by slice; the English player exists, diagrams and languages do not. |
| Use in a study with participants | **Not approved** | Study protocol, institutional approval, current source material, and fresh usability gates are still required. |
| Give to patients as recovery instructions | **Do not use** | Clinical copy and visuals remain unverified drafts without partner-clinician approval. |

In short: this is ready to share as an honest working project, not as a finished medical product.

## What changed on September 17, 2026

The Dr. Hoots mascot direction was retired after clinician feedback. The mascot-guided Watch experience, the vertical TikTok-style cuts, the character system, the host-video generation scripts, and the activation host pipeline were removed from the repository. Git history keeps them.

The replacement is a segmented, narrated, multilingual guide with a provider file, specified in `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md`. Slices 1 through 3 of that design are in place: five segments cut from the canonical sentences and bound to the existing narration, with per-segment timelines, captions, and audio under `assets/captions/v2/` and `assets/audio/v2/`; the one-page guide; and generated anatomy masters composed with deterministic overlays on the narration clock, reviewed caption-blind by AI observers with receipts.

## What changed on September 18, 2026

The API evaluator ran live. Under placeholder rules approved by John until Song weighs in, it failed two pictures the in-session loop had passed: the base head, whose incision was too faint to see, and the bandage card, whose tape read as something stuck in the skin. A tweak pass followed. The incision is now drawn in code along a measured path, because three image edits in a row drew tick marks, a pink glow that read as redness, or a loop onto the neck. The tape is drawn as short see-through strips across it. Panel 4 says "Check for tape", the crossed-out bottle in the two-paths frame says "Do not clean yet", and the guide's type is larger throughout.

Slice 4 added Spanish and Mandarin (Simplified Chinese). Each has a pack with all 27 sentences and every label, checked against the English: every label present, digits unchanged, and the fever threshold kept as a protected phrase. Chinese captions and picture labels break between characters, with no spaces between words. AI language reviewers check each pack for clinical equivalence, protected values, a grade 7 register, and natural phrasing for Bay Area speakers. A pack counts as AI-reviewed only when three independent reviewers pass the same version of it, because one reviewer run misses problems. The Spanish round-one reviewer passed a label that round two failed, and the Mandarin panels caught three problems that single rounds had passed: a sentence that first read as "put it on your ear for you", day labels (第2天) that often mean "the next day", and a chapter title that said "bathe" (洗澡) where the instruction says "shower" (淋浴). It took five Mandarin rounds and three Spanish rounds. Receipts are under `content/reviews/es/` and `content/reviews/zh/`, named by the pack version they bind to. Narration in both languages waits on John's pick between the two test voices. Until then, the guide shows Spanish or Mandarin page text with English audio, transcript, and captions, and says so in the status strip.

Slice 5 added the provider file. On `guide/provider.html` a provider pastes the dot-phrase block from their own note. The page reads it in the browser with no account and no network call, shows what the guide will use and where each value came from (the block or a preset), and lists the lines it could not read. It builds a patient link whose settings live only in the URL fragment, so nothing reaches a server log, and the link never carries a name. Only five lines drive the guide: antibiotic, pain medication, follow-up date, language, and the "Reviewed by" line. The presets (antibiotic yes, pain medication yes, English, no follow-up date) are placeholders for Song to confirm. Medication wording lives in a new canonical module, `ci/medications`, drafted from the UCSF EARS page with status `surgeon_review`, because medication instructions always need the surgeon. Segment 2 is pre-rendered in four variants, one for each yes/no combination of the two medication beats, and the link picks one. A "no" has no source wording yet, so that beat is left out and the status strip says the details are pending the surgeon's wording. The follow-up date is drawn as live text, never narrated; on phones, that frame shows only the date, because the transcript below already carries the sentences. English narration covers the medication beats. The Spanish and Mandarin medication sentences passed their own three-reviewer panels.

Slice 6 added a simulated Song reviewer. Its rubric (`reviewers/song/`) has one check for each of the seven things Song asked for on 2026-09-17, plus workflow fit. An evidence script (`npm run review:song-evidence`) serves the build and drives the installed Chrome. It measures what code can: segment lengths, captions and narration per language, chapter jumps, the language switch, the provider's paste-to-link time and network requests, the review line reaching the guide, and whether the card link is on the first screen. It also captures ten screenshots at desktop and phone widths. Three independent reviewers judge each build from that packet. A reviewer may fail a check whose facts pass, but never pass one whose facts fail, and receipts bind to a hash of every file the guide serves. Every receipt says "Simulated Song review (AI), not Song's approval". The first panel found three problems the facts had missed, all now fixed: in Spanish the chapter rail clipped chapter 5, the card link on phones was not on the first screen, and a follow-up date from the link never reached the transcript. The guide now shows review badges at the end of the transcript: the translation review, the simulated Song review, and "Reviewed by clinician" with the date from the provider's link. The second panel, on the fixed build, fails only the three checks that need Spanish and Mandarin narration (narrator, subtitles, and languages); its receipts are under `content/reviews/song/`.

On September 19 the guide went from five chapters to seven. Spanish and Mandarin narration ran over the 35-second ceiling in the day-2 chapter and the when-to-call chapter (Spanish about 40 s each, Mandarin 37.8 s and 48.6 s). The translated text is 30 to 40 percent longer, and the English-origin voice speaks Mandarin slowly. Both chapters are now split in every language, so chapter numbers mean the same thing in every language: "Day 2: bandage off", "Day 2: tape or no tape", "When to call: all three signs", and "When to call: any one of these". No new speech was needed.

Slice 7 added export. `npm run export` turns every fixed segment, in every narrated language, into a verified 1080×1920 MP4 under `artifacts/v2-export/`, which git ignores, with a manifest of each file's duration and sha256. Every segment except the medication segment (number 3) is fixed; that one depends on the provider's link, so it stays in the web guide. Each video has a title strip, a square picture stage, a fixed two-line caption band with the spoken word highlighted, and the prototype notice. The top 150 px and bottom 250 px stay clear for platform controls. The export page (`guide/export.html`) draws each moment with the guide's own frames and captions. Pictures are static, so a video is a sequence of stills that change only where a beat, caption, or spoken word starts. ffmpeg joins them with the narration, and ffprobe checks size, codecs, and duration. The English videos export and verify in about a minute, against a 30-minute target. Object storage and a promotion pointer wait until there is a bucket; the manifest stands in for the pointer.

## What exists

1. A scroll-driven safety-card guide with a downloadable PDF, at `preview/animatic-scroll.html`.
2. The versioned clinical content model in `content/`, which every format derives from.
3. The v2 segment model, English label pack, and derived caption and audio artifacts, with validators wired into `npm run check`.
4. The v2 guide under `guide/`: one page with a chapter rail, one continuous player across the seven segments with synchronized captions, and a transcript that follows playback and seeks on tap. On phones the transcript carries the captions and the phone numbers stay pinned at the bottom.
5. Generated anatomy masters under `assets/anatomy/` with deterministic overlays, including the incision and its tape drawn along a measured path, contracted in `content/anatomy/`, reviewed caption-blind by AI observers with receipts under `content/reviews/anatomy/`, clinician review pending. Spend is tracked in `content/spend/v2-ledger.json` against a cap John set at $10 and raised to $12 on September 18 for this version.
6. An API-backed image evaluator (`npm run review`) that runs with only an API key: three caption-blind observers receive the image inside the request, a coder cites each finding in their numbered answers, and code computes the verdict. It writes receipts, keeps the manifest in step, records spend in the ledger, and chains onto generation with `--review`. A labeled calibration set checks it against the in-session loop (`npm run review:calibrate`).

## What is technically verified

- Canonical content structure and source-claim records validate.
- Format adaptations map back to canonical sentences and propositions.
- Media projections contain identifiers and behavior rather than copied clinical strings.
- Narration tracks validate against their exact copy and timestamps.
- The seven v2 segments cover every canonical sentence exactly once, in order, under the 35-second ceiling, and their committed captions and audio match the source.
- The deterministic suite passes.

Run `npm run check` to reproduce the content and engineering checks. These results prove contracts and wiring, not presentation quality or clinical approval.

## Known gaps

### 1. Narration in Spanish and Mandarin, the provider file, and export are not finished

Spanish and Mandarin have AI-reviewed text but no narration yet; that waits on John's voice pick. AI review is not a certified medical translation: a qualified human translator must check both packs before any patient use. Until they are narrated, the simulated Song review cannot pass, and only English exports. The medication wording is an evidence draft pending Song's review, and a "no" to either medication has no wording at all until Song supplies it. The guide shows generated anatomy composites for the wound-care, warning-sign, and programming beats; the milestone, number, and follow-up beats show live text. The red, swollen incision did not pass the image loop within its attempt cap, so the redness frame tints the accepted swelling master with a vector flush. The bandage card fails its live review on its tape panel: every observer reads the removal correctly, but two of three imagine a patient pulling the tape off. Across fifteen observers in five reviews, most said the picture never says whether the tape stays on, and the guide's text does not say either. That waits on Song (`q.tape-after-three-days`).

### 2. Clinical and institutional inputs are missing

The project still needs:

- the current EHR after-visit summary and the clinician partner's dot phrase;
- authorized clinician redlines and applicability decisions, including medication wording;
- approved symptom-to-urgency and contact instructions;
- clinical approval for every instructional visual;
- institutional review of naming, branding, study use, and patient use.

Public UCSF source pages are recorded as evidence inputs, but they do not make this an official UCSF resource.

### 3. Human evidence is missing

Before any participant-facing claim, run whole-experience checks for keyboard and screen-reader behavior, reduced motion, mobile and zoom layouts, caption-only and visual-only comprehension, and at least five fresh viewer-recall observations. Record blocked, partial, and failed gates explicitly.

## Best next contributions

1. Song answers `q.tape-after-three-days` and `q.incision-appearance` in `content/clinician/questions-for-song.md`. The card then says what to do with the tape, and one live review, which the remaining budget covers, re-judges it.
2. John picks a narrator voice for Spanish and Mandarin from the voice tests; then `node --env-file=.env.local scripts/generate-v2-narration.mjs --language es` (and `--language zh-Hans`) narrates both, about $0.36 together, and `node scripts/build-segment-media.mjs` rebuilds their captions.
3. Song marks up the draft dot phrase on the provider page (`guide/provider.html`), confirms the presets, and supplies wording for patients who get no antibiotic or no prescription pain medicine.
4. Add browser-level accessibility and rendered-state tests at desktop, 390px mobile, and 200% zoom.
5. Keep experimental formats comparable by preserving canonical proposition coverage and measuring delivery differences rather than rewriting the medical content per format.

## Source-of-truth rules

- Clinical meaning belongs in `content/canonical/`.
- Adapted wording must retain sentence, proposition, and source-claim mappings.
- Generated clinical media remains `patient_use: false` until the authorized review chain is complete.
- A passing automated test, AI critique, screenshot, or private-production gate must never be described as clinical or patient approval.
