# Open questions for Song

One list, in the repository, so nothing waits in a chat thread. Each question has an id that the instruction claims in `content/instructions/` point at. A question is `open` until Song answers; then it becomes `answered` with the answer and the date, and the claim that depends on it must change in the same commit, or the check fails.

Format rule for the validator: each question is one bullet that starts with its id in backticks, then `(open` or `(answered`.

## Instructions where the picture cannot show the how until you tell us

- `q.remove-dressing` (open, asked 2026-09-17; sentences wc.01; frame-01) — On day 2, how does the patient take the head dressing off: untie the knot and unwind it, or cut it? Can they do it alone, or should a caregiver? What if the gauze sticks to the incision? Is the pad over the ear separate from the wrap, and does it come off with it or on its own? The guide currently pictures untying the knot and unwinding the gauze by hand, as an assumption. *When answered:* wc.01 may gain a how sentence, and the pictured sequence is confirmed or redrawn.
- `q.tape-appearance` (open, asked 2026-09-17; sentences wc.02; frame-01) — What does the tape over the incision look like at UCSF: several thin strips across the line, one strip along it, or something else? The card currently draws one plain strip along the line under a magnifier. Two of three reviewers thought the label "Tape?" might mean "apply tape"; would "Is there tape?" be clearer for your patients? *When answered:* the panel is redrawn and relabeled to match.
- `q.tape-after-three-days` (open, asked 2026-09-17; sentences wc.03, wc.04; frame-0203-paths) — After three days, does the tape fall off on its own, does the patient remove it, or does it stay until the wound check? Does the no-tape cleaning routine start once it is off? *When answered:* a sentence may be added and the two-paths frame adjusted.
- `q.cleaning-technique` (open, asked 2026-09-17; sentences wc.05, wc.06; frame-0203-paths) — With what do they clean: a cotton swab, gauze, or something else? Dab or wipe? Along the line or only the edges? How is "equal parts hydrogen peroxide and distilled water" prepared and stored? *When answered:* the cleaning steps get how-to pictures.
- `q.ointment-application` (open, asked 2026-09-17; sentences wc.07; frame-0203-paths) — Applied with what, how much, and where: a thin layer along the line, or on the edges only? Before or after the area dries? *When answered:* the ointment step gets a how-to picture.
- `q.shower-water-on-incision` (open, asked 2026-09-17; sentences wc.08; frame-0405-milestones) — From day three, may water run over the incision? Anything to avoid, such as scrubbing or soaking? How should the area be dried? *When answered:* the milestone beat gains a picture or stays text.

## Already pending from the dot-phrase draft

- `q.medication-text` (open, asked 2026-09-17; segment 2 conditional beats) — Your wording for the antibiotic and pain-medication sentences that the provider file switches on and off.
- `q.dot-phrase` (open, asked 2026-09-17) — Confirm or correct the drafted dot-phrase columns: antibiotic yes/no, pain medication yes/no, follow-up date, "reviewed this video" with date.
- `q.timing-track` (open, asked 2026-09-17) — Deferred until your call and ED data lands: which segments should be tied to which post-op day.

## How we judge the pictures, for your sign-off

- `q.instruction-picture-rule` (open, asked 2026-09-18; rule in `reviewers/anatomy/adjudicator.md`, enforced by `scripts/lib/adjudication.mjs`) — Three reviewers who see only the picture must each say what it tells them to do, and all three must get it right. We also make each of them name one way a worried patient could misread it. For an action that can run backwards, such as taking a bandage off, they always name the reverse ("it could be putting it on"), even when they themselves read it correctly. Our rule: that forced answer alone does not fail the picture. It fails only when two or more reviewers name the same misreading and it involves harm or the wrong body part. That rule has already caught gauze that read as cloth at the throat and a dashed line that read as "cut here". John approved this for now on 2026-09-18. Is it acceptable to you, or do you want any named misreading to fail a picture? *When answered:* the rule is confirmed or tightened, and the two pictures it passed are re-judged.
