# Adjudication rules

Since 2026-09-18 no model returns the verdict. The coder (`coder.md`) records what each observer said, with a verbatim quote for every finding, and it codes each review twice. Code checks each quote against the answer it cites and applies the rules below in `scripts/lib/adjudication.mjs` to each coding. A picture passes only when every coding passes; when they disagree it fails and is marked unsettled for the clinician. `npm run check` refuses any receipt whose verdict does not follow from its recorded findings.

## State pictures: the strict rule

A state picture shows a body part in a particular state, such as the healed incision or a swelling. It fails when any required item is recovered by fewer than three observers, or when any observer states a forbidden reading anywhere. That includes a reading they raise and set aside, or one they name as a possible misreading. It also fails when an observer reports text or a mark that the picture should not have.

## Instruction pictures

An instruction picture is a static card in the manner of an airline safety card: numbered panels, an arrow where something moves, no animation. It is judged on what the observers say the picture tells them to do, which is question 5. Question 4 makes every observer name an alternative, and for a reversible action the reverse action is always available, so that answer alone cannot fail the picture. Observations of bandage removal showed this repeatedly: observers who read the card as coming off still offered "going on" when asked for an alternative.

- Every required item must be recovered by all three observers, from questions 2, 3, and 5.
- A forbidden hit counts when an observer's own reading in questions 2, 3, or 5 states it. A hedge about one panel viewed in isolation does not count when the observer's own conclusion in question 5 is the intended action.
- An alternative from question 4 counts as a forbidden hit only when two or more observers name the same alternative and it involves harm or the wrong body part. It has caught two real defects: gauze routed under the chin read as cloth at the throat, and a dashed line on a tape strip read as "cut here".
- The contract lists the marks that are part of the picture by design (numerals, an arrow, a magnifier, a label). Any other text fails the picture.
- Every question-4 alternative is recorded in `design_notes` for the clinician, whatever the verdict.
- Observers get no hint about panels or reading order; the numerals must carry it.

Every receipt records `verdict_strict` under the strict rule beside `verdict`, so the clinician sees both.

This rule was introduced on 2026-09-18 during the first motion test. John approved it for now the same day. Song's sign-off is question `q.instruction-picture-rule` in `content/clinician/questions-for-song.md`. The rule is written in code in `scripts/lib/adjudication.mjs`, tested in `tests/v2-adjudication.test.mjs`, and `npm run check` refuses any receipt whose verdict does not follow from its recorded findings.

## History

Until 2026-09-18 an adjudicator model read the contract and the observations and returned the verdict itself. Smaller-model adjudicators credited items the observers denied, invented forbidden hits, and failed images on criteria outside the contract. Their verdicts were discarded and re-run, and the receipts record this.
