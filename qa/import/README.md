# The import corpus

Eight synthetic after-visit summaries, written to look like text a real ENT practice might already have:
prose with no labels, a numbered list, an Epic SmartPhrase whose labels differ from ours, ALL-CAPS
headings, text copied out of a PDF with hard wraps (in two variants, wrapped and indented), a whitespace
medication table, and our own draft template as the control.

None of it is a real patient's, a real practice's, or copied from a copyrighted source. The phone numbers
are fake.

They exist because every other test in this project starts from `content/provider/dot-phrase-draft.txt` —
the one document the parser was written against. Pointed at anything else, `parseProviderBlock` returned
`fields = {}` on all six realistic samples: every value in every patient link came from
`content/provider/presets.json`, which is marked `status: placeholder_for_song`, `patient_use: false`.

`tests/v2-import.test.mjs` holds these files to one invariant — nothing the clinician wrote may vanish —
and records, as characterisation, the hazards that are still open decisions rather than bugs.
