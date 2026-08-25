# Patient usability gate

Status: required independent simulated-patient gate for every private prototype variation. This is not research with real patients and does not assess medical correctness.

## Method

Test each variation as an adult patient or caregiver with no assumed cochlear-implant vocabulary at desktop, 390px mobile, 200% zoom, keyboard only, and reduced motion. Score every applicable item:

- `0` — fail
- `1` — partial
- `2` — pass

A variation passes only when every applicable item scores `2` and no critical failure occurs.

## Shared rubric

| Dimension | Required evidence for `2` |
| --- | --- |
| Orientation and terminology | Within five seconds, the evaluator can say what the experience covers and what to do first. Clinical terms are explained on first use. Internal labels such as “Activation,” “Caption,” “current scene,” or production terminology are absent. |
| Task comprehension | After each beat, the evaluator can answer “What happens?”, “Who does it?”, and “What should I understand?” No essential meaning depends on interpreting the illustration. |
| Readability and scannability | Copy targets grade 7 or below except necessary clinical names. Each beat contains no more than two short ideas. Body text and captions are at least 18px with at least 1.4 line height, remain unclipped at 200% zoom, and require no horizontal scrolling at 390px. |
| Navigation and controls | The next action is obvious without instructions. Controls work by keyboard, have visible focus, use at least 44px targets, and communicate play, selection, and position clearly. Users can go back without losing their place. |
| Video-host flow | Dr. Hoots opens the video, explains its purpose, and connects clinical scenes without delaying or obscuring them. The owl is a host, not the sole carrier of medical meaning. Everything spoken is available in synchronized visible captions. |
| Scrollytelling flow | One visual story advances through discrete reader-paced beats. Visual and text correspond, back-scrolling restores the prior beat, and there is no scroll trapping, automatic advancement, stacked-card feeling, or meaning that depends on motion. |
| Accessibility and reduced motion | The complete experience works with keyboard navigation, 200% zoom, visible captions, and `prefers-reduced-motion`. Reduced motion preserves every step and relationship as a static sequence. Meaning never depends only on audio, motion, color, illustration, or Dr. Hoots. |
| Trust and draft status | The review context establishes that this is a private prototype before the participant opens it. The prototype itself contains no institutional chrome that implies an official UCSF patient site. |
| Recall | After leaving the active scene, the evaluator can restate every proposition without adding a claim. For the programming scene: an audiologist programs the external processor, and the program is tailored to the person. |

## Variation gates

### Mascot-guided video

- One Play action starts a coherent beginning-to-end experience and continues through every chapter.
- Play/pause, scrubber, elapsed and total time, playback speed, progress, and completion are unambiguous.
- The optional chapter rail uses patient-language names, clearly marks the active chapter, checks completed chapters, and shows per-chapter duration.
- The evaluator can open or replay a chapter without losing orientation. Record whether the rail is used and ask, “Would you rather this just played?”
- Captions are always visible during speech, span the player width, and highlight words in sync with the narration.
- In diagram-led scenes, Dr. Hoots identifies the speaker beside the caption while the clinical illustration owns the main stage. In the activation healing and follow-up host-led pilot scenes, main-stage Dr. Hoots visibly speaks without a duplicate caption avatar; the synchronized caption remains complete and no gesture carries clinical meaning.
- Redundant agendas, controls, labels, or transcript blocks do not compete with the video.

### Scrollytelling

- A visual scene stays paired with short advancing text.
- The active beat is unmistakable and back-scrolling is reversible.
- Mobile preserves the visual/text relationship.
- Reduced motion presents the same sequence statically.
- The result does not read as a vertical card stack.

## Critical failures

- The evaluator cannot recall the active scene’s key meaning.
- Necessary meaning exists only in audio, animation, color, or illustration.
- Controls, scrolling, or chapter navigation prevent completing or revisiting the sequence.
- Text clips or becomes unreadable on mobile or at 200% zoom.
- Prototype status is mistaken for finalized patient guidance.

## Gate record

No variation is approved under this rubric until the independent patient evaluator records a separate result for mascot-guided video and scrollytelling.
