# Evaluation gates

> The Dr. Hoots character system, host clips, and mascot-guided formats were retired on 2026-09-17. Character gates below were removed; clinical-content gates are unchanged and still apply to the v2 segmented guide.

No stage advances because an artifact merely exists. The relevant independent evaluator must return `PASS`; a `FAIL` includes required repairs and is re-run after those repairs.

## Stage order

1. Concept baseline → design evaluator
2. Canonical clinical modules → surgical-content evaluator
3. Media build approach → both evaluators
4. Finished media derivatives → design evaluator plus surgical drift check

## Gate record

- Concept baseline: `PASS` — independent design evaluator, 2026-08-22.
- Canonical clinical modules: `EVIDENCE-DRAFT PASS` — independent surgical-content evaluator, 2026-08-22. Authorized for private concept prototypes only; current EHR AVS and partner-surgeon approval remain required before patient use.
- Previous three-shell media approach: `SUPERSEDED` — the 2026-08-22 design/media and evidence-draft passes remain historical evidence for the shared scene contract, but no longer describe the current format structure.
- Current two-shell consolidation: `PENDING RE-EVALUATION` — the former linear and chaptered video shells are now one mascot-guided video that plays through by default and offers optional chapter navigation. Scrollytelling remains the second shell. The underlying clinical propositions and illustration are unchanged, but the revised interaction and hierarchy still require a fresh design/media and patient-usability gate.
- Dr. Hoots character system and host clips: `RETIRED` 2026-09-17. The v2 segmented guide supersedes the mascot-guided formats.
- Programming-visit v13 regression: `SUPERSEDED FORMAT PASS` — the 2026-08-23 linear, chaptered, scrollytelling, final design/media, and final surgical-content passes remain evidence for the source content and media assets. They do not approve the current two-shell interaction. This was simulated evaluation for private critique, not patient research or clinical approval.

## Surgical source hierarchy

1. Current UCSF EHR-generated AVS and patient-specific discharge orders — unavailable, eventual protocol source of truth.
2. Partner surgeon instructions and redlines — resolves conflicts and local details.
3. Current UCSF Cochlear Implant Center materials:
   - [Post-operative care and when-to-call guidance](https://ohns.ucsf.edu/otology-neurotology/cochlear-implant-center/surgery)
   - [Activation guidance](https://ohns.ucsf.edu/otology-neurotology/cochlear-implant-center/activation)
   - [Emergency-contact routing](https://ohns.ucsf.edu/otology-neurotology/cochlear-implant-center/emergency-contact)
   - [Appointment timeline](https://ohns.ucsf.edu/sites/ohns.ucsf.edu/files/2023-11/Cochlear%20Implant%20Timeline.pdf)
4. FDA, NIDCD, and clinician-edited general references — clarification only; they cannot override local protocol.
5. Prototype copy, generated visuals, manufacturer pages, and secondary articles are not clinical authorities.

## Surgical content gate

Two outcomes are distinct:

- `EVIDENCE-DRAFT PASS`: suitable only for private concept work and labeled `Unverified — not for patient use`.
- `PATIENT-READY PASS`: impossible until the current AVS and surgeon approval exist.

Every module must pass all applicable checks:

- Every clinical statement maps to a claim in the source ledger.
- No unsupported advice, reassurance, diagnosis, timing, urgency, exception, or promise.
- Numbers, units, comparison operators, conditions, symptom conjunctions, and contact details match the source.
- One versioned canonical artifact supplies every medium.
- Transcripts, captions, chapter text, and scroll text preserve the same clinical propositions.
- Visuals introduce no new anatomy, technique, severity, expected appearance, or clinical meaning.
- Copy targets seventh-grade readability without altering meaning.
- Safety and contact information never depends on audio.
- Draft status and source limitations are prominent.

### Wound care

The UCSF public source describes two paths that must never be blended:

- Dressing removal at day two.
- No tape: the source's twice-daily 50/50 peroxide and distilled-water cleaning path plus ointment instruction.
- Tape present: keep dry for three days; no cleaning.
- Showering and hair washing at day three.
- Approximately two-week wound check.
- Dissolvable sutures.

Fail for presenting peroxide as universal, adding activity or medication advice, or demonstrating wound-care technique visually before surgeon review.

### When to call

- Preserve each UCSF warning condition independently.
- Preserve fever as greater than 101.5°F; do not silently change the comparator.
- Do not invent routine, urgent, or emergency tiers.
- Do not label any symptom normal without explicit approval.

### Activation

- State only that activation follows healing and an audiologist programs the external processor for the individual.
- Device checks and follow-up may be described without promises.
- Do not state one exact activation interval while official sources conflict.
- Do not predict sound quality, improvement, practice regimens, or device-specific behavior.

## Required module metadata

- Stable module ID and semantic version
- Procedure, care site, audience applicability, and recovery phase
- Canonical text and content hash
- Claim-level source IDs with URL, retrieval date, visible revision date, and passage location
- Structured numbers, units, deadlines, branches, contact details, and urgency terms
- Status: `unverified_draft`, `surgeon_review`, `approved`, `superseded`, or `blocked`
- Reviewer and eventual approver metadata
- Reading-level result and unresolved terminology
- Derivative hashes and visual-to-claim mappings

## Mandatory surgeon-review triggers

- Any conflict among the EHR AVS, surgeon, and public UCSF material
- Wound-care, medication, activity, timing, or follow-up instructions
- Adult/pediatric differences, combined procedures, or patient-specific exceptions
- Urgency classification, fever thresholds, symptom grouping, or phone routing
- Any clinical illustration or animation
- Claims about what is normal, safe, expected, or improving
- Activation timing, expected sound quality, rehabilitation, or device behavior
- Translation or simplification that changes clinical meaning

## Design gates

### Concept baseline

- One readable hypothesis at grade 7 or below.
- Overview contains only the hypothesis, proposed directions, and resource links.
- Each direction has one plain-language sentence and an honest unfinished state.
- The question, two directions, and references are identifiable in about 10 seconds.
- UCSF is the documented basis for typography, digital colors, spacing, links, focus, and accessibility without copying the institutional banner or implying official status.
- Desktop and mobile preserve hierarchy without clipping or hidden content.
- Keyboard navigation, visible focus, reduced motion, semantic headings, and WCAG AA contrast pass.
- Every repository link and asset works, and the review URL renders the repository version.
- Clinical examples are source-traced or explicitly marked unapproved.


### Media variations

Shared requirements:

- All formats consume the same versioned canonical modules.
- Clinical actions, warnings, numbers, terminology, and order do not drift.
- UCSF-derived interface rules and diagrams are shared; only pacing, navigation, and motion vary.
- Critical information is available without color, sound, animation, or image interpretation.
- Mobile, keyboard, screen-reader order, 200% zoom, visible focus, contrast, and reduced motion pass.

Format requirements:

- Segmented narrated video (v2): captions synchronized to narration, no generated video, every segment 35 seconds or less, gates by artifact class as listed in the v2 design spec.
- Scroll guide: semantic clinical text, no scroll-jacking, correct reading order without animation, equivalent diagram text, and no critical instruction dependent on pinning, parallax, or timing.

### Automatic design failures

- Fake UCSF chrome, unapproved logos, or implied official ownership
- Oversized editorial heroes, decorative cards, gradients, shadows, pills, or meta-copy that compete with instructions
- Ambiguous generated medical imagery or fake generated text
- Different clinical propositions, source-claim scope, numbers, or thresholds across formats, including wording changes without a reviewed adaptation record
- Text embedded only in images
- Contrast below WCAG AA, missing keyboard/focus/caption/transcript/alternative/reduced-motion support
- Autoplaying audio, keyboard traps, essential timed content, rapid flashes, or unpausable motion
- Broken links, missing assets, or a review URL that differs from the repository
