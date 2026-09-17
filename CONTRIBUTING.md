# Contributing

Thanks for helping improve the experiment. The safest way to contribute is to keep delivery-format work separate from clinical-content decisions.

## Set up

```bash
npm install
npm run dev
```

Open [http://localhost:4173](http://localhost:4173), and run the full deterministic gate before opening a pull request:

```bash
npm run check
```

## Change boundaries

- **Presentation-only work:** HTML, CSS, interaction, pacing, responsive behavior may change without rewriting clinical propositions.
- **Clinical copy:** change `content/canonical/` first, retain source and review metadata, and then update every mapped adaptation. A passing validator is not human clinical approval.
- **Clinical visuals:** keep them explicitly marked `patient_use: false`; do not treat AI review as authorization.
- **Generated media:** do not run generation commands unless you intend to call a paid external service. Keep `FAL_KEY` only in ignored `.env.local` files, never in code, manifests, issues, or commits.
- **Production state:** `.production/`, raw artifacts, browser traces, and local evaluator receipts are intentionally ignored. Promote only the small, reviewable inputs or outputs needed by the public prototype.

## Pull requests

Please include:

1. The user-visible or architectural outcome.
2. Which pages or content modules changed.
3. The result of `npm run check`.
4. Screenshots or short recordings for visual changes at desktop and 390px mobile.
5. Any gate that remains blocked, partial, failed, or awaiting an authorized reviewer.

Do not describe a change as patient-ready, clinically approved, or institutionally approved without durable evidence from the authorized human review process.
