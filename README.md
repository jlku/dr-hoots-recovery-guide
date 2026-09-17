# Recovery-guide experiments

> The Dr. Hoots mascot direction was retired on 2026-09-17. Its media, pages, and host-video pipeline were removed; the segmented, narrated guide specified in `docs/superpowers/specs/2026-09-17-avs-v2-segmented-guide-design.md` replaces it.

An open prototype exploring how cochlear-implant recovery information can work as short narrated video segments and as a scroll-driven, printable safety-card guide.

> [!IMPORTANT]
> This is an independent design and engineering study. It is **not** an official UCSF project, a clinically approved patient resource, or medical advice. All clinical content and instructional visuals remain drafts until reviewed by an authorized clinician and institution.

## What to look at first

1. Open the project locally and start at `index.html`.
2. Read the scroll-driven safety-card guide at `preview/animatic-scroll.html` and the printable PDF it pairs with.
3. Open the segmented narrated guide at `guide/index.html`: five short videos with captions and a contents page, English only for now, driven by the segment data in `content/segments/`. The design spec lives in `docs/superpowers/specs/`.
4. Read [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) before treating any surface as finished. It separates what works technically from what still needs design, accessibility, usability, and clinical review.

## Quick start

Requirements: Node.js 20.6 or newer. FFmpeg is optional for local preview, but enables the full radio-cut integration test; that test is reported as skipped when `ffprobe` is unavailable.

```bash
npm install
npm run dev
```

Then open [http://localhost:4173](http://localhost:4173).

The browser experiences are static HTML, CSS, JavaScript, JSON, audio, and video. The local server is needed because the pages fetch shared JSON modules; opening the HTML files directly with `file://` will not reliably work.

## Verify a change

```bash
npm run check
```

That command validates canonical content, medium-specific copy mappings, media projections, narration, the private production contract, and the deterministic test suite. It does **not** establish clinical correctness, visual quality, accessibility, or patient comprehension.

## How the project is organized

| Path | Purpose |
| --- | --- |
| `content/canonical/` | Source of truth for clinical propositions, claims, source status, and review status |
| `content/adaptations/` | Format-specific wording mapped back to canonical sentence and proposition IDs |
| `content/scenes/` | Shared scene model used by the delivery experiments |
| `assets/` | Shared interface, audio, caption, and illustration assets plus manifests |
| `preview/` | Standalone scrollytelling, card, and pamphlet prototypes |
| `scripts/` | Validators and reproducible media/production tooling |
| `tests/` | Deterministic content, production-boundary, rendering-contract, and evaluation tests |
| `docs/` | Evaluation gates, current status, the image review loop, and the v2 spec and plans |

The central architectural rule is that presentation formats may change pacing, grouping, navigation, and visual treatment, but they may not silently change clinical meaning.

## Building on it

Good starting points are listed in [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md). Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing clinical copy, generated media, or anything that calls an external model.

The repository includes generation commands that require `FAL_KEY` in an ignored `.env.local` file and may spend money. Normal development and `npm run check` do not require credentials or paid generation.

## License and notices

The original project code and documentation are available under the MIT License. Institutional names and marks are not licensed or endorsed, and third-party source material remains subject to its original terms. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).
