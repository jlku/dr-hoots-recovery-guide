# Media variation build decision

Status: mascot-led private guide assembled with a minimal-illustration policy; fresh design/media and patient-usability evaluation remain pending. Nothing is approved for patient use.

## Recommendation

Build one content-and-scene system with two presentation shells. Do not create independent scripts, asset sets, or clinical layouts.

Author every approved scene as a claim-mapped visual beat. The read guide turns those beats into a reader-paced scrollytelling sequence with a sticky visual on larger screens and paired static visuals on small screens. The mascot-guided video uses the same beats, illustrations, and clinical propositions inside a Dr. Hoots-hosted player; it does not introduce a separate clinical language.

The current browser proof lives in `variations.html`: both shells resolve the same activation scene objects through `assets/safety-card.js`. The programming visit uses one separately manifested, visibly unreviewed concept illustration on that private prototype surface. The authoritative clinical-media manifest remains blocked. The complete 14-scene, live-text-only card is rendered on `design-system.html#application` without the private override.

```text
canonical modules
      ↓ sentence IDs
shared scene manifest
      ├── mascot-guided video player
      └── scrollytelling renderer
```

The generated projection manifest contains IDs and behavior only. Canonical clinical text remains in `content/canonical/ci-phase0-v0.1.0.json` and is resolved at view time. Any medium-specific wording lives in a versioned adaptation record that maps every phrase back to canonical sentence IDs, clinical propositions, and source claims.

## Fixed and variable

| Layer | Fixed across all formats | May vary |
| --- | --- | --- |
| Clinical meaning | Module version, sentence IDs, propositions, source claims, numbers, contact routes, branches | Nothing |
| Editorial wording | Approved meaning and claim mapping | Sentence length, cadence, and grouping through a reviewed adaptation record |
| Character | When present, approved Dr. Hoots identity, expressions, gesture rules, clay treatment | Host appears only in video formats; pose timing and placement may vary |
| Visuals | Asset ID, claim mapping, approved static fallback | Transition and reveal timing |
| Interface | UCSF-derived type, color, focus, contrast, text priority | Player controls, chapter navigation, scrolling |
| Audio | Same canonical propositions and versioned medium adaptation | Pauses, delivery timing, and format-specific phrasing |

## Shared scene contract

Each scene will contain:

- stable scene ID and module version;
- ordered canonical sentence IDs;
- optional narration timing tied to those IDs;
- visual asset ID and approved-claim IDs;
- static fallback and essential-visual description;
- motion class, duration, and reduced-motion behavior;
- clinical-visual review status.

A blocked visual has no asset ID, asset hash, or approval record and cannot render. A surgeon-approved visual must carry an asset ID and hash plus the approver, timestamp, artifact version, scene ID, and exact source-claim IDs that were reviewed. Changing only the review-status field cannot unlock an asset.

The scene layer may group sentences for pacing. Medium-specific wording is allowed only through a versioned adaptation record and must pass surgical-equivalence review.

Every generated narration, caption, transcript, and visible-text track is keyed to the module version, content hash, and adaptation version when applicable. A canonical or adapted-copy edit makes prior tracks stale and non-renderable until rebuilt and validated. Automated speech-to-text comparison may verify render fidelity, but it never grants clinical approval.

## Format shells

### A. Mascot-guided video

- Plays the shared scenes in canonical order by default, without an agenda slide.
- Provides an optional “What to expect” chapter rail for direct access. The active chapter has a strong current state, completed chapters have checkmarks, and every chapter shows its duration.
- Uses one navigation system: the rail jumps between chapters; the bottom controls contain only play/pause or replay, a scrubber, elapsed and total time, and 0.75×–2× playback speed.
- Records whether the reviewer uses the chapter rail. Reviewers are also asked, “Would you rather this just played?” Navigation burden is a study measure, not a separate media arm.
- Keeps the active spoken script as a synchronized, always-visible HTML caption—not raster text inside video or a duplicate transcript. The current prototype highlights each word from the narration track's generated character timestamps.
- Diagram-led scenes use Dr. Hoots as a small speaker identity beside the caption while the clinical illustration owns the main video area. The activation healing and follow-up pilot scenes are the narrow host-led exception: Dr. Hoots may occupy the main stage while visibly speaking, the caption avatar is suppressed, the synchronized caption carries the complete proposition, and gestures remain non-clinical.
- Keeps the complete experience under 180 seconds.
- Does not trim or rewrite a scene when it is opened directly.

### B. Scrollytelling guide

- Renders every clinical proposition in semantic document order before motion is added.
- Uses approved static assets first; CSS or browser animation is progressive enhancement.
- Pairs short text beats with one sticky visual stage on larger screens; back-scrolling restores the prior visual.
- Omits the Dr. Hoots presenter layer. Approved clinical illustrations fill the visual stage; scenes without approved art use a restrained numbered sequence marker.
- Has no scroll-jacking, essential pinning dependency, parallax, or timed reading requirement.
- Keeps the full experience readable with JavaScript off and with reduced motion.

## Production approach

For the experiment, keep clinical media deterministic and constrain generated motion to the non-clinical host layer:

- In the video format, Dr. Hoots is a presenter layer that points or holds; the character never demonstrates clinical technique. The reader-paced format has no mascot layer.
- Text, diagrams, and controls stay as live interface layers.
- Clinical diagrams are authored as reviewable SVG/HTML states with explicit claim mappings. No wound-care technique is drawn before surgeon approval.
- The current private build already has three canon Dr. Hoots host performances: welcome, healing, and follow-up. Programming remains diagram-led with Dr. Hoots identified beside the synchronized caption. No additional generated host video is required for the current scene plan. A separate provisional FAL ElevenLabs voice track supplies the narration, and its character timestamps drive the active-word highlight in the visible HTML caption.
- The scroll format uses the same approved scene assets and static keyframes rather than a separately generated visual set.
- The generated clip falls back to its approved source still, and `prefers-reduced-motion` prevents playback.

The provisional voice uses the `fal-ai/elevenlabs/tts/eleven-v3` model with the George voice and is stored with its generation parameters, request ID, source text, and timestamps in `assets/audio/manifest.json`. Run `npm run narration:generate` to rebuild it after an approved copy change. This is a critique asset, not final voice casting or a clinical approval record.

The host clip is a prototype dependency, not a clinical-content dependency. FAL attempts with a hand-like wing or wing drift are retained as rejected records in `assets/video/manifest.json`; only a design-gated clip may render. If the active clip drifts in face, anatomy, clothing, pin, texture, or timing, the player must return to the deterministic still/rig rather than ship the drift.

## Vertical-slice order

1. **Activation:** proves Dr. Hoots, live text, captions, chapters, and reduced motion without depicting wound care. Exact timing remains absent because the official sources conflict.
2. **When to call:** proves safety lookup, `> 101.5°F`, phone routing, replay, and scan speed without inventing urgency tiers.
3. **Wound care:** last, because tape/no-tape branching and every technique illustration require direct surgeon review.

This is build order only. The patient-facing presentation order remains wound care → when to call → activation in every format.

After each vertical slice, both evaluators inspect both shells before the next module is added.

## Acceptance gates

The approach passes only when:

- generated projections contain the exact canonical module, sentence, proposition, and source-claim order;
- every format contains the exact required delivery channels and modes;
- any medium-specific text has a validated adaptation record and surgical-equivalence review;
- all formats remain useful without audio, color, animation, or image interpretation;
- every visual has a static fallback and claim mapping;
- clinical visuals default to blocked until surgeon review;
- the video and scrollytelling formats resolve the same approved clinical media assets;
- keyboard, screen-reader order, zoom, focus, contrast, always-visible captions, and reduced motion pass;
- the surgical drift check and design media gate both return `PASS`.

## Deferred until finished-derivative review

- Full scene art
- Wound-care animation
- Patient-ready host-video production pipeline
- Voice casting
- Video export pipeline
- Patient-ready wording or publication
