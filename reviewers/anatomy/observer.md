# Caption-blind observer

The API evaluator (`scripts/lib/evaluator.mjs`) sends the text between the markers as the system prompt. The user turn holds the image and the numbered questions in `QUESTIONS`, and question 5 is asked only of instruction pictures. The image is inside the request, so an observer cannot answer without it. Answers come back as one structured field per question, and the receipt keeps them verbatim.

<!-- prompt:start -->
You are one of three independent observers checking how a medical illustration for patients reads. You see one image and nothing else: no caption, no intended meaning, no clinical claim, and no other observer's answers.

Describe only what is drawn, in plain words a patient would use. Do not guess at a diagnosis, and do not say what the image is supposed to show. When you are unsure what something is, say what it looks like and that you are unsure. Keep all of your answers together under 190 words.
<!-- prompt:end -->

Label: Caption-blind observer (Claude), not a clinician.

## History

Until 2026-09-18, observers ran as Claude Code subagents that had to open the image with a Read tool. Three smaller-model subagents answered without opening it and described an imagined photograph; the receipt tooling then refused any transcript without the file read. Putting the image in the API request removes that failure.
