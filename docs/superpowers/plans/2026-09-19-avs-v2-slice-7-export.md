# AVS v2 Slice 7: 9:16 Export of the Fixed Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every fixed segment, in every narrated language, exports as a 1080×1920 MP4. The video carries the segment's narration, its pictures, and burned-in two-line captions with the spoken word highlighted, and it is verified against its timeline.

**Architecture:** An export page (`guide/export.html`) composes one 9:16 canvas: a title strip, a square picture stage, and a fixed two-line caption band. It uses the same frame renderer, timeline, and caption logic as the guide, and exposes `renderAt(seconds)`. Pictures are static (the manifest's motion is `static`), so the video is a sequence of stills. A new still is needed only where a beat, a caption cue, or a spoken word changes. The export script serves the build, drives the installed Chrome through `playwright-core`, and captures one still per change point. `ffmpeg` concatenates the stills with their exact durations and muxes the segment's narration. `ffprobe` then verifies size, codecs, and duration.

**Tech Stack:** Vanilla ES modules, `node:test`, `playwright-core` with the installed Google Chrome, `ffmpeg` and `ffprobe` (libx264, AAC).

**Spec:** `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md`, sections 2 (MP4 export last, small, fixed segments only, 9:16), 4 (canvas), 9 (export under 30 minutes), 12 step 7.

## Global Constraints

- Only fixed segments export: no conditional beats and no data fields. Segment 2 carries the patient's medication choices and follow-up date, so it stays in the web guide, where the provider's link personalizes it.
- Canvas 1080×1920, top to bottom:
  - a title strip (segment number, title, day chip);
  - a square picture stage;
  - a fixed two-line caption band in large type that never moves or shrinks;
  - the "Private prototype. Not for patient use." notice.
  Keep social safe zones clear: nothing essential in the top 150 px, the bottom 250 px, or the right 120 px of the stage area's edge.
- Captions are the same cues as the guide, with the spoken word highlighted.
- Outputs go to `artifacts/v2-export/` (gitignored), with a `manifest.json` that records the build hash, and each file's segment, language, duration, still count, and sha256. Object storage and a promotion pointer wait until there is a bucket; the manifest is the pointer.
- Nothing new is generated and nothing is paid for: export only arranges committed media.
- `patient_use: false` everywhere.

## File Structure

| File | Responsibility |
| --- | --- |
| `guide/export.html`, `guide/assets/export.js` | The 9:16 composition and `renderAt(seconds)` |
| `guide/assets/guide.css` | Export canvas rules under `.export-body` |
| `guide/assets/logic.js` | `fixedSegments(segments)`, `exportChangePoints(timeline)` |
| `scripts/export-segments.mjs` | Serve, capture stills, encode, verify, write the manifest |
| `package.json` | `export` script |
| `tests/v2-export.test.mjs` | Pure logic and page structure |

---

### Task 1: Which segments export, and where a still changes

**Interfaces:** `fixedSegments(segments) -> segment[]` (no beat with `condition`, no `data_fields`); `exportChangePoints(timeline) -> number[]`, the sorted unique times in `[0, duration)` where a beat, a cue, or a word starts or ends, always including 0.

- [ ] Test: fixed segments are numbers 1, 3, 4, 5. Change points start at 0, are strictly increasing, all lie below the duration, and include every cue start and every word start of segment 1.
- [ ] Implement in `logic.js`; commit `feat: which segments export, and where each still changes`.

### Task 2: The export page

**Interfaces:** `guide/export.html?segment=<n>&lang=<code>` sets `window.exportReady` (a promise of `{ duration, points, audio, language }`) and `window.renderAt(seconds)` (a promise that resolves when the canvas shows that moment, with its images decoded). It refuses a segment that is not fixed.

- [ ] Structure test: the page has the title strip, stage, caption band, and notice; it loads `assets/export.js`; there are no raw prompt fields.
- [ ] Implement with the guide's `renderFrame`, `renderTitleCard`, `activeBeat`, `activeCue`, `assignWordsToCues`, and `activeWordIndex`.
- [ ] Browser check at 1080×1920: segment 1 in English at 0 s (title card), at a mid-beat word (picture and caption with one word highlighted), and at the last cue. Two caption lines fit at 60 px. Chinese caption lines wrap between characters.
- [ ] Commit `feat: a 9:16 export page that shows any moment of a fixed segment`.

### Task 3: Capture, encode, verify

- [ ] `scripts/export-segments.mjs [--out artifacts/v2-export] [--language en] [--segment 1]`:
  - For each fixed segment and each narrated language, render every change point and save one PNG per still.
  - Write an ffmpeg concat list with each still's duration (the last still is repeated, as the concat demuxer requires).
  - Encode `libx264` at `yuv420p` and 30 fps, with AAC audio from the segment's narration, to `<out>/<language>/<segment-slug>.mp4`.
  - Verify with `ffprobe`: 1080×1920, h264 and aac, and duration within 0.15 s of the timeline.
  - Write `manifest.json`. Report total wall time against the 30-minute target.
- [ ] Run it for English. Look at three stills per file and one full MP4 frame grab per file.
- [ ] Commit `feat: export the fixed segments as verified 9:16 MP4s`.

### Task 4: Record the slice

Update `docs/PROJECT_STATUS.md`: what exports, where it goes, how long it takes, and what waits (Spanish and Mandarin exports follow their narration). Run `npm run check`, then commit `docs: record slice 7`.
