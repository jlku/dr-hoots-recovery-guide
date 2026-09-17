# Safety-card image evaluation loop

This loop prevents a caption from rescuing an image that communicates the wrong medical action, location, state, threshold, or branch. It applies only when the production decision says an image materially improves comprehension. Text-led cards are the default for timing, branch logic, warning lists, contact routes, and other claims that are clearer as live text.

It does not grant clinical or patient-ready approval. An authorized clinical reviewer and the current EHR after-visit summary remain required for clinical cards.

## Creation decision

Before researching or generating an image, record why the viewer needs to see anatomy, spatial location, an action, or a physical state. If the same meaning is clearer as live text with narration, do not create a diagram.

The previous mascot-led guide, retired 2026-09-17, used full illustration only for:

- the day-two mastoid-dressing removal and behind-ear tape check; and
- the programming appointment with the audiologist and external processor.

The wound-care paths, milestones, warning logic, contact numbers, and recap are intentionally text-led. One reusable posterior-auricular anatomy family may be added later only if observation testing shows that the location remains unclear.

## Reference-grounded creation sequence

1. **Claim packet** — identify the canonical sentence IDs, anatomy, action, state, timing/comparator, branch logic, and forbidden inferences.
2. **Real-world reference search** — collect three to five claim-specific references. Use real postoperative photographs for dressing/incision/tape geometry, official medical-center or FDA diagrams for implant anatomy, and manufacturer or hospital photography for external processors. Record the source URL, retrieval date, role, and rights/use status. Search-result thumbnails are not references until their source pages are opened and verified.
3. **Reference roles** — explicitly label which source controls anatomy, action, device geometry, and rendering style. Style art never controls medical facts.
4. **Master plus edits** — create one anatomically grounded master and derive matched states through controlled edits. Do not independently redraw clinical anatomy for every state.
5. **Candidate inspection** — reject visible artifacts and every prohibited wrong inference before spending observer effort.

The working grounding packet is `evals/safety-cards/medical-reference-packet.md`; project-local user references are stored in `evals/safety-cards/references/`.

## Evaluation gate sequence

1. **Revision binding** — hash the raw candidate and wrapped render. Every receipt is immutable and valid only for that exact pair, evaluation version, and evaluation mode.
2. **Blind observation** — three independent reviewers see only the evaluation image. They are not shown the intended meaning, clinical claims, benchmark, captions, or earlier findings. Illustration cards use the raw art without captions; text-led cards use the wrapped render.
3. **Semantic adjudication** — a separate reviewer compares the three observations with the structured contract. Any wrong anatomy, action, state, threshold, sequence, branch, or harmful alternative interpretation fails the hash.
4. **Design review** — a fresh reviewer compares the wrapped render with frame 13 and the design-system primitives, including crop, caption collisions, register, hierarchy, and the two-second test.
5. **Clinical review** — an authorized human reviewer checks the image and wrapped render against every listed claim ID. AI review may prepare findings but cannot satisfy this gate.
6. **Private approval** — all applicable gates pass for the same hashes. The result remains `patient_ready: false`.

A failed receipt cannot be outweighed by later passes. A semantic failure requires new candidate art; changing only the wrapper cannot unlock it. A design failure requires a new wrapped render. Cards that fail both need both revisions before the loop restarts.

## Commands

```bash
node scripts/safety-card-eval.mjs list
node scripts/safety-card-eval.mjs status
node scripts/safety-card-eval.mjs status frame-0710 --json

# Packet output is JSON and can be handed to a fresh reviewer.
node scripts/safety-card-eval.mjs packet frame-0710 observe
node scripts/safety-card-eval.mjs packet frame-0710 adjudicate
node scripts/safety-card-eval.mjs packet frame-0710 design
node scripts/safety-card-eval.mjs packet frame-0710 clinical

# Emit every currently pending clinical packet with canonical claim text and source status.
node scripts/safety-card-eval.mjs clinical-bundle

# Validate and immutably store a completed reviewer receipt.
node scripts/safety-card-eval.mjs record /path/to/receipt.json

# Store a non-empty JSON array of receipts (each receipt is still validated independently).
node scripts/safety-card-eval.mjs record-batch /path/to/receipts.json

# During a repair round, explicitly ignore receipts whose bound candidate or wrapper changed.
node scripts/safety-card-eval.mjs record-batch /path/to/receipts.json --skip-stale

# Record just one card from a multi-card batch.
node scripts/safety-card-eval.mjs record-batch /path/to/receipts.json frame-recap
```

The checked-in baseline hashes are intentionally locked in `repair_required`, so they will not issue observation packets. After replacing the appropriate candidate and/or wrapped asset, `status` advances the card and `packet` emits the next allowed review packet.

Receipts are stored under `evals/safety-cards/receipts/<card>/<candidate-hash>/`. The CLI rejects stale hashes, out-of-order gates, reused reviewer identities, mutable receipt IDs, malformed roles, and clinical receipts without a reviewer name, credential, and authorization reference.

## Reviewer separation

- Observation reviewers must set `saw_expected_contract`, `saw_reference`, and `saw_prior_findings` to `false`.
- Start each observation reviewer with no inherited conversation or repository context. Give it only the observation packet and the single evaluation image; do not fork a generation or adjudication thread.
- The semantic adjudicator sees the contract and blind observations, but does not author or repair the art.
- The design reviewer must be fresh and must compare both reference images.
- The clinical reviewer must be an authorized human. This loop never treats a simulated reviewer as clinical approval.

Receipt identity fields are review-process evidence, not cryptographic identity proof. Keep clinical authorization records in the governing clinical system and put only their durable reference in the receipt.

## Acceptance policy

- Any incorrect or ambiguous medical location, action, state, comparator, or branch is `FAIL`.
- Any harmful alternative interpretation is `FAIL`.
- “The caption explains it” is not an allowed defense for an illustration card.
- Text-led cards may depend on readable live text, but their hierarchy and routing must remain unambiguous.
- A passing private card is still not a patient-ready card.

## Current production disposition

1. `frame-01` remains an illustration candidate and requires caption-blind observations.
2. `frame-13` remains the programming illustration and visual-register benchmark.
3. `frame-0203`, `frame-0405`, `frame-06`, and `frame-0710` are text-led in the mascot-guided video; their failed raster concepts are not production candidates.
4. `frame-11` and `frame-recap` remain typographic cards.

For clinically meaningful anatomy, generate only from verified real-world references and a written visual contract. Branches, thresholds, conjunctions, and contact routes remain live text unless a picture independently improves understanding without inventing meaning.
