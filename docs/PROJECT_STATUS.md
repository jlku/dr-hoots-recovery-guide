# Project status and handoff

Last updated: August 25, 2026

## Readiness verdict

| Use | Status | Why |
| --- | --- | --- |
| Share with a designer or developer for critique and iteration | **Ready, with this document attached** | The project runs locally, the architecture is documented, and deterministic checks pass. |
| Treat as a finished design direction | **Not ready** | The current Watch composition has unresolved presentation-coherence issues, and the directions have not completed fresh comparative usability evaluation. |
| Use in a study with participants | **Not approved** | Study protocol, institutional approval, current source material, and fresh usability gates are still required. |
| Give to patients as recovery instructions | **Do not use** | Clinical copy and visuals remain unverified drafts without partner-clinician approval. |

In short: this is ready to share as an honest working project, not as a finished medical product.

## What exists

The homepage presents three ways to deliver related recovery information:

1. A mascot-guided Watch experience with captions, chapters, clinical cards, and fallback states.
2. A short vertical-video experiment testing a more native social-video rhythm.
3. A scroll-driven safety-card guide with a downloadable PDF.

All formats are intended to derive clinical meaning from the versioned content model in `content/`, while presentation code and generated media stay replaceable.

## What is technically verified

As of the date above:

- Canonical content structure and source-claim records validate.
- Format adaptations map back to canonical sentences and propositions.
- Media projections contain identifiers and behavior rather than copied clinical strings.
- Six narration tracks validate against their exact copy and timestamps.
- The private three-scene production contract validates.
- The deterministic suite passes 58 tests.
- The production dependency audit reports zero known vulnerabilities.

Run `npm run check` to reproduce the content and engineering checks. These results prove contracts and wiring, not presentation quality or clinical approval.

## Known gaps

### 1. Watch presentation needs a reset

The latest whole-experience audit classified the current Watch composition as `repair_required`. The main issues were mixed visual languages, production numbering leaking into patient UI, too many simultaneous caption/card/chapter surfaces, variable caption height, and clipped warning content. The next version should be a separate low-chrome renderer with patient-language chapters, one concept per scene, and a fixed caption region.

Do not generate more host footage or clinical art merely to preserve the current composition. Approve the information architecture and storyboard first.

### 2. Visual evaluation is incomplete

The earlier seven-card adversarial evaluation had a mean score of 5.71/10; no card reached the required 8+ threshold. Failures included inconsistent illustration style, unclear clinical state changes, missing actions or exact claims, and layout collisions. The deterministic SVG/card system is useful infrastructure, but it is not equivalent to a fresh independent visual pass.

### 3. Clinical and institutional inputs are missing

The project still needs:

- the current EHR after-visit summary;
- authorized clinician redlines and applicability decisions;
- approved symptom-to-urgency and contact instructions;
- clinical approval for every instructional visual;
- institutional review of naming, branding, study use, and patient use.

Public UCSF source pages are recorded as evidence inputs, but they do not make this an official UCSF resource.

### 4. Human evidence is missing

Before any participant-facing claim, run whole-experience checks for keyboard and screen-reader behavior, reduced motion, mobile and zoom layouts, caption-only and visual-only comprehension, and at least five fresh viewer-recall observations. Record blocked, partial, and failed gates explicitly.

## Best next contributions

1. Build a media-light Watch V2 shell from an approved storyboard: three patient-language chapters, one concept per scene, fixed two-line captions, and no production IDs.
2. Add browser-level accessibility and rendered-state tests at desktop, 390px mobile, and 200% zoom.
3. Replace or revise one failed safety-card visual at a time, then run fresh blind observation, semantic, design, and authorized clinical gates against the exact artifact hash.
4. Keep experimental formats comparable by preserving canonical proposition coverage and measuring delivery differences rather than rewriting the medical content per format.

## Source-of-truth rules

- Clinical meaning belongs in `content/canonical/`.
- Adapted wording must retain sentence, proposition, and source-claim mappings.
- Dr. Hoots may orient or transition; the mascot must not demonstrate clinical technique or carry clinical meaning by gesture alone.
- Generated clinical media remains `patient_use: false` until the authorized review chain is complete.
- A passing automated test, AI critique, screenshot, or private-production gate must never be described as clinical or patient approval.
