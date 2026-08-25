# V1 script consolidation and host-scene proposal

Status: **APPROVED by John 2026-08-23** with one amendment — the intro names the procedure: "Hi, I'm Dr. Hoots. Here's what to expect after your cochlear implant surgery." Host grammar confirmed: intro + healing + follow-up on stage. Composite is the v2 host plan of record. Implemented in the animatic same day (actual runtime 2:17 — the numbers scene reads its phone digits slowly, on purpose). Every rewritten spoken line remains a **draft adaptation** that must pass the surgical-content gate before pipeline reproduction.

## Who this script is for

A post-cochlear-implant patient in recovery days 0–14. Three facts should drive every script decision:

1. **They may hear poorly or not at all right now.** The implanted ear is silent until activation; many CI candidates have severe loss in both ears. Captions are the primary channel, narration the secondary one — so pacing must follow *reading* speed, and nothing may depend on audio (already a gate rule).
2. **They are post-surgical**: tired, possibly medicated, possibly anxious, often older, often watching with a caregiver. One idea per scene; act-first sentence order; no throat-clearing.
3. **They will rewatch.** The video is a reference, not a lecture — chapters matter more than narrative flow, and shorter chapters are easier to re-find.

## Question 1 — the script is too long; scenes could consolidate

Agreed on both counts. Current cut: 20 scenes, 2:41, ~14s of it non-instruction (cover + three part titles + welcome). Proposed v1.1 cut: **12 scenes, ~1:55.**

Each scene specs BOTH channels: the spoken script (= caption, complete) and the card (the glanceable subset). See "The card rule" below for how the split is decided.

| # | Scene (proposed) | Consolidates | Draft spoken script (adaptation — needs content gate) | On the card (all values claim-mapped) |
|---|---|---|---|---|
| — | Intro | cover + welcome | "Hi, I'm Dr. Hoots. Here's what to expect after your surgery site heals." *(unchanged)* | Nothing — host owns the stage. |
| 1 | Day 2: bandage off, check for tape | 01 | "Two days after surgery, remove the head bandage. Then check: is there tape over the incision behind your ear?" | Frame 01 as built: `01` · `DAY 2` chip · bandage on → off pictogram · tape inset `TAPE?` · "Check behind the ear". Chip may carry "mastoid dressing" as the clinical term (wc.01). |
| 2 | The two paths | 02 + 03 | "If there is tape — keep the area dry until three days after surgery, and do not clean it before then. If there is no tape — clean the edges gently twice a day with equal parts hydrogen peroxide and distilled water, then apply an antibiotic ointment such as bacitracin." | Existing split frame, both halves full strength: left "Tape present" · `KEEP DRY · 3 DAYS` · prohibition "No cleaning before day 3"; right "No tape" · steps `1 2 3` · `2× A DAY` · `50/50 mix` · `ointment`. Active half follows the narration; the other stays readable. |
| 3 | The next milestones | 04 + 05 | "Three days after surgery, you may shower and wash your hair. Your wound check and ear exam are about two weeks after surgery — the stitches dissolve on their own." | NEW merged frame: recovery track with two stops — `DAY 3` "Shower + hair" · `≈ 2 WEEKS` "Wound check + ear exam" · inset "Stitches dissolve". Marker advances with the narration. |
| 4 | Redness: all three signs | 06 | "Call your surgeon or clinic if all three of these are true: the incision is red and swollen, it is not getting better over one to two days, and it hurts when touched." | Frame 06 as built: `ALL 3 TOGETHER` chip · three equal checklist rows: "Red and swollen" / "Not better in 1–2 days" / "Hurts when touched", ticking with the narration. |
| 5 | Also call for any of these | 07 + 08 + 09 + 10 | "Also call for any of these: a fever above 101.5 degrees Fahrenheit; swelling, or fluid building up, behind your ear; a headache, light sensitivity, or excessive lethargy; or any question or concern about you or your child." | NEW list frame: `ANY OF THESE` chip · four equal rows, landing with the narration: "Fever above `101.5°F`" / "Swelling or fluid behind the ear" / "Headache · light sensitivity · lethargy" / "Any question or concern". No tiers, identical weight. |
| 6 | The numbers to use | 11 | "For routine questions, leave a message on the nursing line: 415-353-2148. You should get a call back within 12 hours — if no one calls, call again. For an emergency, call 415-476-1000 and ask for the Otolaryngology resident on call." | Frame 11 as built: two route panels — "Routine questions" `415-353-2148` "callback within 12 hours · call again if none" / "Emergency" `415-476-1000` "ask for the Otolaryngology resident on call". |
| 7 | After healing | 12 | *(unchanged, act.01)* | Nothing — host-led (approved clip). Reduced motion falls back to frame 12's timeline card. |
| 8 | Your first programming visit | 13 | *(unchanged, chaptered adaptation)* | Frame 13: the approved illustration; no on-frame text beyond the card furniture. |
| 9 | Visits that continue | 14 | *(unchanged, act.04–05)* | Nothing — host-led (approved clip). Reduced motion falls back to frame 14's calendar/loop card. |
| — | Closing | outro | "That's the guide. Replay any part, or read it at your own pace." | Recap card: `1` Care for the surgery site · `2` When to call · `3` First programming visits. |

### The card rule (how narration vs. card is decided)

1. **The caption carries every spoken word** — the complete proposition. For a post-CI audience captions are the primary channel; nothing may live only in audio (existing gate rule).
2. **The card carries the glanceable subset**: every spoken number, threshold, day, duration, and phone value; condition structure (branches, all-three logic); and action labels of three words or fewer. It is the pause/scrub/rewatch layer — dual-coding the critical values.
3. **The card may compress but never add.** Nothing appears on-frame that is not in that scene's canonical sentences; every on-frame item maps to sentence/claim IDs exactly like copy does (feeds the gates' required visual-to-claim mappings).
4. **Live text only** — text baked into an illustration is an existing automatic design failure; illustrations depict, labels stay text.
5. **Equal weight within a list** — grouping never invents urgency tiers.

Enforcement: `preview/assets/frames.js` is the single frame definition both formats render (card content cannot drift between scroll and video); at pipeline graduation the on-frame text joins each scene's claim-mapped record and passes the same surgical-content gate as the narration.

Rules honored: every number, threshold, comparator, and phone number verbatim; the two wound-care paths stay explicitly separated inside one scene (both halves visible — comparability improves); grouping the four independent "call if" items adds no urgency tiers (all equal weight, matching the scroll page's call list). Two wording changes to flag for the evaluator: "head bandage" without "mastoid dressing" on first mention (the frame chip can carry the term), and "is there tape…?" as a question form of wc.02.

Estimated runtime at current voice pacing: ~1:52–2:00 (saves ~45s, cuts scene count 20 → 12, chapter count 16 → 12). Part titles become 1.5-second wipes inside their first chapter, as already structured.

**If approved:** I write the adaptation records, run them through the content validators, regenerate the 6 changed tracks (~$0.20), and re-cut the animatic. Nothing about the locked UI changes.

## Question 2 — host scenes: mascot + text/diagram, or postpone?

**Recommendation: postpone composed host scenes to v2; v1 ships the grammar we already have** — which is slightly more than "intro only":

- **V1 (no new generation):** Dr. Hoots main-stage in the intro (approved clip), and in the healing and follow-up beats (the two *paid, review-approved, lip-synced* clips — dropping them buys nothing). Caption avatar everywhere else. This is exactly what the animatic does today, and it's already inside the gate rules (R4–R7). If you'd rather have the stricter "intro only" consistency, it's a one-line change per frame (`treatment: host_led → diagram_led`) — frames 12 and 14 already have diagram fallbacks built.
- **V2 (the composed scene, specced now so it's not vague later):** host + prop in the two-zone staging from your reference — Dr. Hoots left third, safety-card element right. Two feasible builds, in order of preference:
  1. **Composite, not generation:** generate the host against a clean background with a *directing-attention* gesture from the approved gesture sheet v3 (point right, present, count), then composite the card element beside him in the renderer. Registration is a layout problem, not a generation problem — much safer than asking the model to interact with a real object.
  2. **True interaction** (holding/pointing at a physical card) — higher character-drift risk, burns attempts; only worth it after 1 proves the staging.
  Budget note: each attempt ≈ $0.25–0.47; three scenes with two attempts each fits in ~$3 of the remaining ~$13.5.

## Decision needed from John

1. Approve the 12-scene consolidation (or mark lines to keep/cut) → I run the adaptation + regeneration loop.
2. Confirm v1 host grammar: intro + healing/follow-up host beats (recommended), or strictly intro-only.
3. V2 composed-host approach 1 (composite) as the plan of record — yes/no.
