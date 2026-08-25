# Full-length animatics — direction

These animatics exist to answer one question the gated pipeline cannot: **does the full-length format earn approval?** They are ungated, clearly labeled internal working drafts. The evaluation pipeline, its gates, and its state are untouched; once the format is approved here, the pipeline reproduces it with full traceability.

## The concept (John, 2026-08-23)

The product is an **airline-style safety card** for cochlear-implant recovery: fourteen numbered pictographic frames in one consistent grammar — numbered frames, action arrows, detail insets, prohibition marks, a consistent figure — as already defined in `design-system.html` §04 and `assets/safety-card.js`. The two variations are two deliveries of that one card:

- **Scrollytelling** animates the card frame-by-frame as the reader scrolls (pudding.cool practice: native scroll only, position triggers from `window.innerHeight` pixels, reversible, one DOM at every width).
- **Guided video** plays the same frames through with narration.

## Surfaces

- `preview/animatic-scroll.html` — all 14 frames in the approved `scrolly-critique.html` shell (sticky part rail with passive indicators, text left, sticky stage right, inline frame per beat on mobile).
- `preview/animatic-video.html` — the same frames in the approved watch shell (chapter rail, stage, navy caption band, transport controls), timed to the recorded provisional narration, with a per-scene storyboard below the player.
- `preview/assets/frames.js` — the single frame definition both variations render; each frame records its sentences, chip text, on-frame text, illustration spec, and motion plan.

## Dr. Hoots — the standing rules apply, unchanged

- Not present in scrollytelling.
- In video: speaker avatar beside the caption in diagram-led scenes; **main stage only in the healing and follow-up host-led exception** (approved speaking clips), with no duplicate avatar there.
- The welcome pairs the approved silent clip with the recorded welcome line as a **labeled placeholder**; a speaking welcome performance is still needed.
- Gestures never carry clinical meaning; the card carries the instruction.

## Frame rules

- Placeholder frames use only abstract design-system primitives — no anatomy, no technique depiction — on hatched card stock with a visible "Illustration pending surgeon review" status. Frame 13 (programming) shows the approved illustration as the target quality.
- When-to-call frames keep every condition at equal visual weight; no invented urgency tiers; fever comparator and phone numbers exact.
- All clinical copy is canonical-sentence verbatim, tagged `data-sentence-id`.
- Draft status lives in the ribbon, frame status tags, and footer — no meta-copy inside the patient-facing reading flow beyond those.

## What review history taught (kept from earlier passes)

1. No boxed mascot; no duplicated navigation; no meta-copy in patient surfaces.
2. Scrollytelling: never hide the graphic on mobile; never hijack scroll; no vh-based triggers.
3. Rejected experiments (2026-08-23): full-viewport typographic scenes and a persistent-host video stage — both replaced by the safety-card frame grammar in the approved shells.

## Locks

- **Guided-video UI: LOCKED for v1 (John, 2026-08-23)** — the canvas "Guided Video UI" is the reference: sentence-case chrome with uppercase only in the speaker tag and card furniture; rail rows number | label | time with boundary-rounded tabular durations summing to the runtime; wash-background current row; reserved avatar column so the caption edge never moves; sentence-case Play/Pause; storyboard as one table. Implemented in `preview/animatic-video.html`.
- **V1.1 script: APPROVED (John, 2026-08-23)** — 12 scenes, 2:17, intro names the cochlear implant; consolidated frames 02–03 / 04–05 / 07–10 as video composites (`VIDEO_FRAMES` in `preview/assets/frames.js`); the 14-frame card is unchanged for the scroll guide. Spoken lines are draft adaptations pending the surgical-content gate (`docs/plans/2026-08-23-v1-script-and-host-proposal.md`).
- **V1 host grammar: DECIDED** — intro + healing + follow-up on stage (approved clips), caption avatar elsewhere. **V2 host plan of record: composite** — generate Dr. Hoots with an approved directing-attention gesture on a clean background, composite the card beside him in the renderer.

## Card artwork policy (2026-08-24, after the two-agent round)

Two production strategies were built in parallel (this session's illustrated panels; a concurrent session's deterministic SVGs, which also stubbed the raster generator with the policy "clinical visuals are deterministic; generation may only supply neutral human figures"). Synthesis adopted going forward:

- **Deterministic vector layer owns all clinical semantics**: tape placement, prohibitions, thresholds (101.5°F), phone numbers, branch logic, step order, calendars/day counts, captions, furniture. This class of content is never entrusted to a generative model — every location-drift failure the critic fleet caught came from generated clinical marks.
- **Generated illustration may supply neutral human figures and scenes only** (bandage removal, shower, clinician looking, behind-ear close-ups on bare skin), style-locked to the approved frame-13 register.
- The active deck is swappable per frame via one field (`art` = deterministic SVG · `panel` = illustrated + vector overlays · `panelLayout: "twin-paths"` = hybrid). Deterministic SVGs are always the reduced-motion/fallback layer.
- Open for John: deck emphasis for v1 (deterministic diagram deck — currently active — vs illustrated hybrid deck).

## Approval flow

1. John reviews both animatics and the storyboard; marks up frames, text, pacing.
2. Approved frame specs become the illustration brief (surgeon-gated where required) and the amended production contract.
3. The gated pipeline reproduces the approved artifact with provenance and receipts.
