# The import corpus

Nine synthetic after-visit summaries, one per shape a real practice's instructions come in: prose with no
labels, a numbered list, an Epic SmartPhrase whose labels differ from ours, ALL-CAPS headings, text copied
out of a PDF with hard wraps (wrapped and indented variants), a whitespace medication table, headed
sections with the instruction in the block beneath the label, and our own draft template as the control.

None of it is a real patient's or copied from a copyrighted source. The phone numbers are fake.

## Why the shapes are these shapes

The first six were invented, and inventing them was the mistake. On 2026-09-20 we collected **25 real
published post-operative instruction documents** — UCSF OHNS, UCSF Health, UCSF EARS, UCSF Benioff, and
the ear-surgery and cochlear-implant handouts of Washington University, UNC, Iowa, Dartmouth, Hartford,
Maryland ENT, Northside, Queen's, Texas ENT, UMMC Mississippi, UW Medicine, plus the AHRQ RED discharge
template and two published Epic AVS examples — and measured the parser against them.

Those documents belong to the institutions that wrote them, so they are **not** in this repository. They
were fetched to a scratchpad, measured, and the numbers recorded here. `scripts/measure-import.mjs` takes
a directory, so anyone can re-fetch them and re-run it.

**What the real corpus showed, before any of the fixes below:**

| | measured |
| --- | --- |
| documents yielding any driving value | **0 of 25** |
| documents where the parser matched a line at all | 5 of 25 |
| documents stating a follow-up | 19 of 25 |
| documents stating a bookable follow-up **date** | **0 of 25** |
| documents carrying a language or interpreter field | **0 of 25** |
| occurrences of `pain meds`, `pain med`, `f/u`, `fu`, `rtc`, `abx` | **0** between them |
| documents whose most common label for analgesia is plain `Pain:` | 5, the single most frequent field label in the corpus |
| largest single shape | headed sections, 12 of 25 |

The closed label list had been written from imagination. It contained six strings that appear nowhere in
25 real documents, and omitted the one that appears most often.

**After the fixes** — a bullet or list number no longer hides a label, `Pain:` and its variants are
recognised, a label alone on its line takes the block beneath as its value, and a follow-up stated as an
interval is a readable answer rather than a failure — the real corpus goes from **0 to 4 of 25** documents
yielding a value, with every line still shown back to the clinician.

Four is not a good number. It is an honest one, and the remaining gap is not a parsing problem: antibiotic
and pain are stated conditionally in most real handouts ("if prescribed", "your surgeon will let you
know"), and in the majority of documents the word *antibiotic* refers to ointment for the incision rather
than a course of tablets. Reading those as yes or no would be guessing, which is the thing this page is
not allowed to do.

## What the tests hold

`tests/v2-import.test.mjs` holds every fixture to one invariant — **nothing the clinician wrote may
vanish** — and records what the page does with a note it cannot read, so that changing it is deliberate.
`node scripts/measure-import.mjs <dir>` reports the numbers for any directory of `.txt` files.
