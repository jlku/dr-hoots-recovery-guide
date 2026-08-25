# Dr. Hoots host-video generation

Status: private prototype asset. The clip contains no clinical action, narration, text, or audio. Clinical meaning remains in reviewed live captions and illustrations.

## Active approach

- Source: `assets/character/dr-hoots-motion-base-v2.png`
- Model: `fal-ai/kling-video/o1/standard/image-to-video`
- Duration: 4 seconds
- First and last frame: the same approved source still
- Output: `assets/video/dr-hoots-welcome-v3.mp4`
- Runtime: muted, inline, user-triggered; static poster under reduced motion or load failure
- Provenance and exact prompt: `assets/video/manifest.json`
- API reference: https://fal.ai/models/fal-ai/kling-video/o1/standard/image-to-video/api

Using the same approved still for both endpoints prevents the generated performance from establishing a new character pose. The prompt allows only a blink and slight head tilt; the wings, clothes, pin, camera, and background must remain stable.

## Rejected attempts

- `dr-hoots-welcome-v1`: rejected because the raised wing read as a human hand and the clip did not return to the source pose.
- `dr-hoots-welcome-v2`: rejected because the model extended both wings despite the tucked-wing constraint.

Rejected attempts remain recorded so later work does not accidentally repeat or reuse them. Their binaries were removed after review; only the approved V3 output ships.

## Regeneration

Run `npm run video:generate`. The script reads `FAL_KEY` from `.env.local`, uploads the approved source still, downloads the result, and records the request ID, model, prompt, source, and review status. A newly generated clip remains unreviewed until the design-video gate passes.
