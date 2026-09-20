# AVS v2 Slice 8: The Script Comes From the Practice Dot Phrase

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Song edits a line of the practice dot phrase, the guide's spoken script follows: only the affected sentences are redrafted, re-narrated, and reviewed again. Nothing a patient's link can change is ever spoken.

**Why.** Three days of QA point at the same root cause. The script is a fixed artifact, but the dot phrase invites edits:

- A provider changed "shower at 3 days" to 5 and the guide kept saying 3; the eval scored this unsafe, and all three walkthrough users hit it.
- The narration says "about two weeks after surgery" while a link can set any follow-up date.
- New instructions a provider adds (NSAIDs, lifting, driving) have nowhere to go.

**Architecture:** Two layers, matching the spec's two clocks.

- **Practice layer, offline and gated.** `content/provider/dot-phrase-draft.txt` is the practice protocol. A generator maps each covered line to its canonical sentences, drafts replacements when the line changes, and routes them through the existing gates: readability, canonical validators, three-reviewer translation panels, narration, and the simulated Song review. Practice-level numbers are spoken, because they are fixed for that practice version.
- **Patient layer, instant.** Only the five driving fields. Patient-level values are never spoken: they are live text on a frame or a pre-rendered variant, as the medication beats and the follow-up date already are.

## Global Constraints

- No spoken sentence may contain a value a patient's link can change. The follow-up date is the first to move out of narration.
- A practice change is a proposal until it passes: canonical validators, readability at grade 7 or below, both language panels, narration validation, and a passing Song panel. `status: surgeon_review` until Song approves, as `ci/medications` already is.
- Only the sentences whose line changed are redrafted and re-narrated. A change costs about $0.03 to $0.10 in narration.
- English chapters stay at about 25 seconds or less, so Spanish and Mandarin fit the 35-second ceiling.
- Canonical sentences keep their source claims. A line Song writes is sourced to the practice protocol, which is the partner-surgeon source the gates have waited for.
- `patient_use: false`. Nothing here is clinical approval.

## Tasks

### Task 1: Move patient-level values out of the narration

- [ ] Rewrite the follow-up sentence so it names no interval: the clinic tells the patient when to come back; the date is the frame's live text, and "about two weeks after surgery" stays only as the text shown when a link carries no date.
- [ ] Update the canonical module, its claims, the English pack, and both translations; run both language panels; re-narrate that beat in three languages.
- [ ] Add an eval case: a one-week follow-up date never contradicts what the patient hears.

### Task 2: The line-to-sentence map becomes the script's spine

- [ ] Extend `content/provider/template-lines.json` so each covered line records the canonical sentences it owns, the beat and chapter they play in, and whether its numbers are practice-level.
- [ ] A validator fails when a covered line owns no sentence, or a sentence belongs to no line.

### Task 3: Propose a script change from a template edit

- [ ] `scripts/propose-script-change.mjs <template.txt>`: compares the edited template with the committed one, and for each changed covered line drafts replacement sentences (Claude, grade 7 or below, one instruction per sentence), for each new line proposes where it belongs (an existing beat, or a new beat and chapter), and writes a proposal file with the old and new text side by side.
- [ ] The proposal is a review packet: Song sees what changed in patient words before anything is built.

### Task 4: Apply an approved proposal

- [ ] `scripts/apply-script-change.mjs <proposal.json>`: updates canonical sentences, segments, and the English pack; marks translations machine drafts; and prints the exact follow-up commands (narration, media, panels, Song review).
- [ ] Re-narrate only the affected beats.

### Task 5: The provider page offers the practice edit

- [ ] When a provider changes a covered line, the page offers "propose this to the guide" next to the warning, which writes the proposal instead of silently dropping the edit.
- [ ] A new instruction the guide does not cover offers the same.

### Task 6: Record the slice

- [ ] `docs/PROJECT_STATUS.md`, the spec's sections 3 and 7, and a note that the practice protocol is now the script's source.
