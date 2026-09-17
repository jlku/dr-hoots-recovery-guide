# Project status and handoff

Last updated: September 17, 2026

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

The replacement is a segmented, narrated, multilingual guide with a provider file, specified in `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md`. Slice 1 of that design is in place: five segments cut from the canonical sentences, bound to the existing narration, with per-segment timelines, captions, and audio under `assets/captions/v2/` and `assets/audio/v2/`.

## What exists

1. A scroll-driven safety-card guide with a downloadable PDF, at `preview/animatic-scroll.html`.
2. The versioned clinical content model in `content/`, which every format derives from.
3. The v2 segment model, English label pack, and derived caption and audio artifacts, with validators wired into `npm run check`.
4. The v2 contents page and player under `guide/`, which play the five English segments with synchronized captions, a language selector, a subtitle toggle, and a live-text transcript.

## What is technically verified

- Canonical content structure and source-claim records validate.
- Format adaptations map back to canonical sentences and propositions.
- Media projections contain identifiers and behavior rather than copied clinical strings.
- Narration tracks validate against their exact copy and timestamps.
- The five v2 segments cover every canonical sentence exactly once, in order, under the 35-second ceiling, and their committed captions and audio match the source.
- The deterministic suite passes.

Run `npm run check` to reproduce the content and engineering checks. These results prove contracts and wiring, not presentation quality or clinical approval.

## Known gaps

### 1. Diagrams, languages, and the provider file are not built yet

Slices 3 through 7 add anatomy diagrams with vector overlays, Spanish and Mandarin, the provider file, AI reviewers with labeled receipts, and file export. The player currently shows the deterministic SVG cards and live-text fallbacks.

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

1. Build v2 slice 3: anatomy masters with deterministic overlays, through the image loop.
2. Add browser-level accessibility and rendered-state tests at desktop, 390px mobile, and 200% zoom.
3. Keep experimental formats comparable by preserving canonical proposition coverage and measuring delivery differences rather than rewriting the medical content per format.

## Source-of-truth rules

- Clinical meaning belongs in `content/canonical/`.
- Adapted wording must retain sentence, proposition, and source-claim mappings.
- Generated clinical media remains `patient_use: false` until the authorized review chain is complete.
- A passing automated test, AI critique, screenshot, or private-production gate must never be described as clinical or patient approval.
