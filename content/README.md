# Canonical clinical content

`canonical/ci-phase0-v0.1.0.json` is the only clinical-content source for the three Phase 0 formats.

`canonical/` locks the clinical propositions, structured values, source claims, and review status. `adaptations/` may change cadence, grouping, headings, and wording for a medium only when every block maps back to the same canonical sentence and proposition IDs. Human surgical-equivalence review remains required because a validator cannot prove semantic equivalence by itself.

It is an evidence draft, not a patient handout. It uses current public UCSF Cochlear Implant Center material because the EHR-generated after-visit summary and partner-surgeon redline are not yet available. Nothing in this folder is patient-ready.

Rules:

- Linear video, chaptered video, and the scroll guide must cover the same ordered clinical propositions and source claims.
- A format may change wording, cadence, grouping, pacing, navigation, layout, and motion. It may not omit, add, or change a clinical proposition.
- Authoritative clinical media remains blocked until surgeon review. Separately manifested concept art may appear only on an explicitly private, unverified prototype surface; it must retain `patient_use: false`, a visible concept-art label, and the underlying clinical-media block.
- Editing an approved version will eventually create a new pending version; the prior published version must remain intact.
- Run `npm run content:validate` and `npm run copy:validate` after any content change.

Current gaps:

- Current UCSF EHR AVS
- Partner-surgeon protocol and redline
- Confirmed adult/pediatric applicability
- Local activity and pain-medication instructions
- Approved symptom-to-urgency mapping
- Reconciled activation timing
- Clinical approval for every instructional visual

## v2 segments and language packs

`segments/ci-phase0-v0.1.0.segments.json` cuts the canonical sentences into five short segments for the v2 guide. Each beat binds sentence IDs to a frame id and to an existing narration record, so captions always reproduce the spoken text. Every canonical sentence appears in exactly one segment, in canonical order; `npm run segments:validate` enforces that, the 35-second narration ceiling, and that the derived files under `assets/captions/v2/` and `assets/audio/v2/` match the source. Rebuild them with `npm run segments:build`.

`translations/<language>/ci-phase0-v0.1.0.json` holds interface labels per language and, for languages other than English, one translated sentence per canonical ID. English resolves its sentences from `canonical/` and never copies them. `npm run translations:validate` checks coverage and that phone numbers and numeric thresholds survive translation. A validated translation is still a draft until the reviewer named in its `review.label` has passed it; AI review is never clinical approval.
