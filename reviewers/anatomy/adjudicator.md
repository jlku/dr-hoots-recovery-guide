# Adjudication rules

Since 2026-09-18 no model returns the verdict. The coder (`coder.md`) records what each observer said, with a verbatim quote for every finding, and it codes each review twice. Code checks each quote against the answer it cites and applies the rules below in `scripts/lib/adjudication.mjs` to each coding. A picture passes only when every coding passes; when they disagree it fails and is marked unsettled for the clinician. `npm run check` refuses any receipt whose verdict does not follow from its recorded findings.

## State pictures

A state picture shows a body part in a particular state, such as the healed incision, a swelling, or the worn processor. It fails for what the observers report seeing: a required item that fewer than three of them recover, a forbidden reading in their own answers, or text or a mark that should not be there. What each observer imagines a worried patient might mistake it for, and anything they raise and then set aside, reaches the clinician as a note on the receipt and does not fail the picture. On these pictures a misreading changes how alarmed a viewer feels, not what they do. In the first live calibration, requiring no such misreading failed every accepted state picture: observers asked for a worried patient's misreading always name something alarming, such as a fresh cut, an eye patch, or an ordinary hearing aid with a stuck-on patch.

Required items must be things an observer can see. An absence, such as "no liquid on the surface", belongs in the forbidden readings, because no observer states an absence; `validateContracts` rejects an absence written as a required item.

This is a placeholder rule, approved for now by John on 2026-09-18. Song's sign-off is question `q.state-picture-misreadings`.

## The strict rule, kept as a reference

Every receipt also records `verdict_strict`: the verdict if any forbidden reading anywhere, including a hedge or an imagined misreading, failed the picture.

## Instruction pictures

An instruction picture is a static card in the manner of an airline safety card: numbered panels, an arrow where something moves, no animation. It is judged on what the observers say the picture tells them to do, which is question 5. Question 4 makes every observer name an alternative, and for a reversible action the reverse action is always available, so that answer alone cannot fail the picture. Observations of bandage removal showed this repeatedly: observers who read the card as coming off still offered "going on" when asked for an alternative.

- Every required item must be recovered by all three observers, from questions 2, 3, and 5.
- A forbidden hit counts when an observer's own reading in questions 2, 3, or 5 states it. A hedge about one panel viewed in isolation does not count when the observer's own conclusion in question 5 is the intended action.
- An alternative from question 4 counts as a forbidden hit only when two or more observers name the same alternative and it involves harm or the wrong body part. It has caught two real defects: gauze routed under the chin read as cloth at the throat, and a dashed line on a tape strip read as "cut here".
- The contract lists the marks that are part of the picture by design (numerals, an arrow, a magnifier, a label). Any other text fails the picture.
- Every question-4 alternative is recorded in `design_notes` for the clinician, whatever the verdict.
- Observers get no hint about panels or reading order; the numerals must carry it.

Every receipt records `verdict_strict` beside `verdict`, so the clinician sees both.

This rule was introduced on 2026-09-18 during the first motion test. John approved it for now the same day. Song's sign-off is question `q.instruction-picture-rule` in `content/clinician/questions-for-song.md`. The rule is written in code in `scripts/lib/adjudication.mjs`, tested in `tests/v2-adjudication.test.mjs`, and `npm run check` refuses any receipt whose verdict does not follow from its recorded findings.

## History

Until 2026-09-18 an adjudicator model read the contract and the observations and returned the verdict itself. Smaller-model adjudicators credited items the observers denied, invented forbidden hits, and failed images on criteria outside the contract. Their verdicts were discarded and re-run, and the receipts record this.
