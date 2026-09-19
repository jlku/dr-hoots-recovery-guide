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

## What exists

1. A scroll-driven safety-card guide with a downloadable PDF, at `preview/animatic-scroll.html`.
2. The versioned clinical content model in `content/`, which every format derives from.
3. The v2 segment model, English label pack, and derived caption and audio artifacts, with validators wired into `npm run check`.
4. The v2 guide under `guide/`: one page with a chapter rail, one continuous player across the five English segments with synchronized captions, and a transcript that follows playback and seeks on tap. On phones the transcript carries the captions and the phone numbers stay pinned at the bottom.
5. Generated anatomy masters under `assets/anatomy/` with deterministic overlays, including the incision and its tape drawn along a measured path, contracted in `content/anatomy/`, reviewed caption-blind by AI observers with receipts under `content/reviews/anatomy/`, clinician review pending. Spend is tracked in `content/spend/v2-ledger.json` against a cap John set at $10 and raised to $12 on September 18 for this version.
6. An API-backed image evaluator (`npm run review`) that runs with only an API key: three caption-blind observers receive the image inside the request, a coder cites each finding in their numbered answers, and code computes the verdict. It writes receipts, keeps the manifest in step, records spend in the ledger, and chains onto generation with `--review`. A labeled calibration set checks it against the in-session loop (`npm run review:calibrate`).

## What is technically verified

- Canonical content structure and source-claim records validate.
- Format adaptations map back to canonical sentences and propositions.
- Media projections contain identifiers and behavior rather than copied clinical strings.
- Narration tracks validate against their exact copy and timestamps.
- The five v2 segments cover every canonical sentence exactly once, in order, under the 35-second ceiling, and their committed captions and audio match the source.
- The deterministic suite passes.

Run `npm run check` to reproduce the content and engineering checks. These results prove contracts and wiring, not presentation quality or clinical approval.

## Known gaps

### 1. Narration in Spanish and Mandarin, the provider file, and export are not finished

Spanish and Mandarin have AI-reviewed text but no narration yet; that waits on John's voice pick. AI review is not a certified medical translation: a qualified human translator must check both packs before any patient use. Slices 5 through 7 add the provider file, the simulated Song review with badges, and file export. The guide shows generated anatomy composites for the wound-care, warning-sign, and programming beats; the milestone, number, and follow-up beats show live text. The red, swollen incision did not pass the image loop within its attempt cap, so the redness frame tints the accepted swelling master with a vector flush. The bandage card fails its live review on its tape panel: every observer reads the removal correctly, but two of three imagine a patient pulling the tape off. Across fifteen observers in five reviews, most said the picture never says whether the tape stays on, and the guide's text does not say either. That waits on Song (`q.tape-after-three-days`).

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
3. Add browser-level accessibility and rendered-state tests at desktop, 390px mobile, and 200% zoom.
4. Keep experimental formats comparable by preserving canonical proposition coverage and measuring delivery differences rather than rewriting the medical content per format.

## Source-of-truth rules

- Clinical meaning belongs in `content/canonical/`.
- Adapted wording must retain sentence, proposition, and source-claim mappings.
- Generated clinical media remains `patient_use: false` until the authorized review chain is complete.
- A passing automated test, AI critique, screenshot, or private-production gate must never be described as clinical or patient approval.
