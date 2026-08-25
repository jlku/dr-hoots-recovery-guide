import { createHash } from "node:crypto";

const EXPECTED_SCENES = Object.freeze([
  "scene/activation/healing",
  "scene/activation/programming",
  "scene/activation/follow-up"
]);

const SCENE_TITLES = Object.freeze({
  "scene/activation/healing": "After healing",
  "scene/activation/programming": "First programming visit",
  "scene/activation/follow-up": "Follow-up visits"
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireIdentity(value, prefix, label) {
  if (
    typeof value !== "string" ||
    !new RegExp("^" + prefix + ":[a-f0-9]{64}$").test(value)
  ) {
    throw new Error(label + " is invalid");
  }
}

function projectionMaterial(manifest) {
  return {
    schema_version: manifest.schema_version,
    content_lock_id: manifest.content_lock_id,
    radio_bundle_id: manifest.radio_bundle_id,
    scene_order: manifest.scene_order,
    asset_paths: manifest.asset_paths,
    html_sha256: manifest.html_sha256,
    javascript_required_for_content: manifest.javascript_required_for_content,
    reversible_back_scrolling: manifest.reversible_back_scrolling,
    patient_ready: manifest.patient_ready
  };
}

function styles() {
  return [
    ":root {",
    "  --ink: oklch(24% 0.045 255);",
    "  --muted: oklch(42% 0.035 250);",
    "  --paper: oklch(97% 0.018 88);",
    "  --wash: oklch(91% 0.034 226);",
    "  --navy: oklch(28% 0.085 255);",
    "  --teal: oklch(53% 0.105 194);",
    "  --sun: oklch(82% 0.16 82);",
    "  --line: oklch(75% 0.028 238);",
    "  --focus: oklch(50% 0.18 35);",
    "  --space-1: .25rem;",
    "  --space-2: .5rem;",
    "  --space-3: .75rem;",
    "  --space-4: 1rem;",
    "  --space-6: 1.5rem;",
    "  --space-8: 2rem;",
    "  --space-12: 3rem;",
    "  color-scheme: light;",
    "}",
    "* { box-sizing: border-box; }",
    "html { scroll-behavior: smooth; background: var(--paper); }",
    "body {",
    "  margin: 0;",
    "  color: var(--ink);",
    "  background: var(--paper);",
    "  font-family: \"Avenir Next\", \"Trebuchet MS\", sans-serif;",
    "  font-size: 1rem;",
    "  line-height: 1.55;",
    "  font-kerning: normal;",
    "}",
    "img { display: block; max-width: 100%; height: auto; }",
    "a { color: inherit; text-underline-offset: .2em; }",
    ".skip-link {",
    "  position: fixed; z-index: 20; inset: var(--space-2) auto auto var(--space-2);",
    "  padding: var(--space-3) var(--space-4); background: var(--sun); color: var(--navy);",
    "  transform: translateY(-150%); transition: transform 140ms cubic-bezier(.25,1,.5,1);",
    "}",
    ".skip-link:focus { transform: translateY(0); }",
    ":focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }",
    ".draft-notice {",
    "  margin: 0; padding: var(--space-3) max(var(--space-4), env(safe-area-inset-left));",
    "  background: var(--sun); color: var(--navy); font-weight: 750; letter-spacing: .01em;",
    "}",
    ".page-head {",
    "  padding: clamp(2rem, 8vw, 6rem) max(var(--space-4), env(safe-area-inset-left)) var(--space-12);",
    "  background: var(--wash); border-bottom: 1px solid var(--line);",
    "}",
    ".eyebrow { margin: 0 0 var(--space-3); color: var(--teal); font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }",
    "h1, h2 { font-family: \"Iowan Old Style\", \"Palatino Linotype\", serif; font-weight: 600; }",
    "h1 { max-width: 12ch; margin: 0; font-size: clamp(2.5rem, 11vw, 6.5rem); line-height: .96; letter-spacing: -.045em; }",
    ".lede { max-width: 54ch; margin: var(--space-6) 0 0; font-size: 1.18rem; color: var(--muted); }",
    ".story-shell { container-type: inline-size; max-width: 78rem; margin: 0 auto; padding: 0 max(var(--space-4), env(safe-area-inset-right)); }",
    ".story-index {",
    "  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2);",
    "  margin: var(--space-6) 0 var(--space-12); padding: 0; list-style: none;",
    "}",
    ".story-index a {",
    "  display: flex; align-items: center; min-height: 44px; padding: var(--space-2);",
    "  border-bottom: 2px solid var(--line); text-decoration: none; color: var(--muted);",
    "}",
    ".story-index a[aria-current=\"step\"] { border-color: var(--teal); color: var(--ink); font-weight: 750; }",
    ".story-step {",
    "  display: grid; gap: var(--space-6); min-height: min(78vh, 46rem);",
    "  padding: var(--space-12) 0; border-top: 1px solid var(--line); scroll-margin-top: var(--space-6);",
    "}",
    ".step-number { margin: 0; color: var(--teal); font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }",
    ".step-copy h2 { margin: var(--space-2) 0 var(--space-6); font-size: clamp(2rem, 8vw, 4.5rem); line-height: 1; letter-spacing: -.035em; }",
    ".step-copy p:not(.step-number) { max-width: 34ch; margin: 0 0 var(--space-4); font-size: clamp(1.18rem, 3vw, 1.55rem); line-height: 1.5; }",
    ".step-visual { align-self: center; margin: 0; }",
    ".step-visual img { width: min(100%, 34rem); margin-inline: auto; object-fit: contain; }",
    ".step-visual--host img { max-height: 27rem; object-position: 50% 35%; }",
    ".step-visual--diagram { padding: var(--space-4); background: oklch(99% .01 88); border: 1px solid var(--navy); }",
    ".step-visual figcaption { max-width: 54ch; margin: var(--space-3) auto 0; color: var(--muted); font-size: .94rem; }",
    ".transcript { border-top: 1px solid var(--line); padding: var(--space-8) 0 var(--space-12); }",
    ".transcript summary { display: flex; align-items: center; min-height: 44px; cursor: pointer; font-weight: 800; }",
    ".transcript pre { max-width: 68ch; white-space: pre-wrap; font: inherit; color: var(--muted); }",
    ".transcript p a { display: inline-flex; align-items: center; min-height: 44px; }",
    ".no-script { padding: var(--space-3); background: var(--wash); color: var(--navy); }",
    ".page-foot { padding: var(--space-8) max(var(--space-4), env(safe-area-inset-left)) max(var(--space-8), env(safe-area-inset-bottom)); background: var(--navy); color: var(--paper); }",
    "@container (min-width: 48rem) {",
    "  .story-step { grid-template-columns: minmax(18rem, .8fr) minmax(24rem, 1.2fr); align-items: center; gap: clamp(2rem, 7vw, 7rem); }",
    "  .story-step:nth-of-type(even) .step-copy { order: 2; }",
    "  .story-step:nth-of-type(even) .step-visual { order: 1; }",
    "}",
    "@media (min-width: 64rem) {",
    "  .story-index { position: sticky; z-index: 5; top: 0; padding: var(--space-3) 0; background: var(--paper); }",
    "}",
    "@media (hover: hover) { .story-index a:hover { color: var(--ink); border-color: var(--teal); } }",
    "@media (pointer: coarse) { .story-index a, .transcript summary { min-height: 48px; } }",
    "@media (prefers-reduced-motion: reduce) {",
    "  html { scroll-behavior: auto; }",
    "  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }",
    "}"
  ].join("\n");
}

function enhancementScript() {
  return [
    "const links = [...document.querySelectorAll('.story-index a')];",
    "const steps = [...document.querySelectorAll('.story-step')];",
    "const byId = new Map(links.map((link) => [link.getAttribute('href').slice(1), link]));",
    "const activate = (id) => {",
    "  for (const link of links) {",
    "    if (link === byId.get(id)) link.setAttribute('aria-current', 'step');",
    "    else link.removeAttribute('aria-current');",
    "  }",
    "};",
    "const observer = new IntersectionObserver((entries) => {",
    "  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);",
    "  if (visible[0]) activate(visible[0].target.id);",
    "}, { rootMargin: '-25% 0px -55% 0px', threshold: [0, .25, .5, .75] });",
    "for (const step of steps) observer.observe(step);",
    "activate(steps[0].id);"
  ].join("\n");
}

export function buildScrollyProjection({
  production,
  timeline,
  transcript,
  contentLockId,
  radioBundleId,
  assetPaths
}) {
  requireIdentity(contentLockId, "lock", "contentLockId");
  requireIdentity(radioBundleId, "radio", "radioBundleId");
  if (
    production?.scope !== "private_concept_only" ||
    production?.patient_ready !== false ||
    timeline?.content_lock_id !== contentLockId ||
    !same(production.scene_order, EXPECTED_SCENES) ||
    !same(timeline?.scenes?.map((scene) => scene.scene_id), EXPECTED_SCENES)
  ) {
    throw new Error("scrollytelling source graph is stale or unsafe");
  }
  for (const key of ["host", "diagram", "captions"]) {
    if (typeof assetPaths?.[key] !== "string" || assetPaths[key].length === 0) {
      throw new Error("scrollytelling asset path is missing: " + key);
    }
  }

  const cuesByScene = new Map(EXPECTED_SCENES.map((sceneId) => [sceneId, []]));
  for (const cue of timeline.cues) {
    if (!cuesByScene.has(cue.scene_id)) throw new Error("unexpected scrollytelling cue scene");
    cuesByScene.get(cue.scene_id).push(cue);
  }

  const nav = EXPECTED_SCENES.map((sceneId, index) => {
    const id = "step-" + (index + 1);
    return (
      '        <li><a href="#' + id + '"' +
      (index === 0 ? ' aria-current="step"' : "") +
      "><span>" + (index + 1) + ". " + escapeHtml(SCENE_TITLES[sceneId]) + "</span></a></li>"
    );
  }).join("\n");

  const articles = EXPECTED_SCENES.map((sceneId, index) => {
    const visual =
      sceneId === "scene/activation/programming"
        ? [
            '          <figure class="step-visual step-visual--diagram">',
            '            <img src="' + escapeHtml(assetPaths.diagram) + '" alt="An audiologist programs an outside-ear speech processor for the person&#39;s needs.">',
            "            <figcaption>The audiologist adjusts the outside-ear speech processor for the person. The diagram supports the explanation; it does not replace it.</figcaption>",
            "          </figure>"
          ].join("\n")
        : [
            '          <figure class="step-visual step-visual--host">',
            '            <img src="' + escapeHtml(assetPaths.host) + '" alt="Dr. Hoots, a clay owl narrator wearing teal scrubs, faces the reader in a neutral pose.">',
            "            <figcaption>Dr. Hoots is the narrator. His pose does not communicate a clinical instruction.</figcaption>",
            "          </figure>"
          ].join("\n");
    const paragraphs = cuesByScene
      .get(sceneId)
      .map((cue) => "            <p>" + escapeHtml(cue.text) + "</p>")
      .join("\n");
    return [
      '        <article class="story-step" id="step-' + (index + 1) + '" data-scene-id="' + sceneId + '">',
      '          <div class="step-copy">',
      '            <p class="step-number">Step ' + (index + 1) + " of 3</p>",
      "            <h2>" + escapeHtml(SCENE_TITLES[sceneId]) + "</h2>",
      paragraphs,
      "          </div>",
      visual,
      "        </article>"
    ].join("\n");
  }).join("\n");

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    "  <title>What happens after healing? · Private activation guide</title>",
    "  <style>" + styles() + "</style>",
    "</head>",
    "<body>",
    '  <a class="skip-link" href="#main-content">Skip to the three steps</a>',
    '  <p class="draft-notice">Private prototype · unverified draft · not for patient use</p>',
    '  <header class="page-head">',
    '    <p class="eyebrow">Three steps after surgery</p>',
    "    <h1>What happens after healing?</h1>",
    '    <p class="lede">Move at your own pace. Read forward for the sequence or scroll back to compare any step. The same approved wording appears in the video and this guide.</p>',
    "  </header>",
    '  <div class="story-shell">',
    '    <nav aria-label="Activation steps">',
    '      <ol class="story-index">',
    nav,
    "      </ol>",
    "    </nav>",
    '    <main id="main-content">',
    articles,
    "    </main>",
    '    <details class="transcript">',
    "      <summary>Read the complete transcript</summary>",
    "      <pre>" + escapeHtml(String(transcript).trim()) + "</pre>",
    '      <p><a href="' + escapeHtml(assetPaths.captions) + '" download>Download captions</a></p>',
    "    </details>",
    "    <noscript><p class=\"no-script\">All three steps and the complete transcript are already available above. Scrolling does not require JavaScript.</p></noscript>",
    "  </div>",
    '  <footer class="page-foot">This private concept still requires clinical review before any patient-facing use.</footer>',
    '  <script type="module">' + enhancementScript() + "</script>",
    "</body>",
    "</html>",
    ""
  ].join("\n");

  const manifest = {
    schema_version: "activation-scrolly-projection/v1",
    projection_id: null,
    content_lock_id: contentLockId,
    radio_bundle_id: radioBundleId,
    scene_order: [...EXPECTED_SCENES],
    asset_paths: structuredClone(assetPaths),
    html_sha256: sha256(html),
    javascript_required_for_content: false,
    reversible_back_scrolling: true,
    patient_ready: false,
    private_concept_only: true
  };
  manifest.projection_id = "projection:" + sha256(JSON.stringify(projectionMaterial(manifest)));
  return { manifest, html };
}

export function validateScrollyProjection(projection, { expectedProjectionId = null } = {}) {
  const manifest = projection?.manifest;
  if (manifest?.schema_version !== "activation-scrolly-projection/v1") {
    throw new Error("scrollytelling projection schema is invalid");
  }
  if (sha256(projection.html ?? "") !== manifest.html_sha256) {
    throw new Error("scrollytelling HTML hash drifted");
  }
  const actualId = "projection:" + sha256(JSON.stringify(projectionMaterial(manifest)));
  if (actualId !== manifest.projection_id) {
    throw new Error("scrollytelling projection identity drifted");
  }
  if (expectedProjectionId && expectedProjectionId !== actualId) {
    throw new Error("stale projection hash");
  }
  if (
    manifest.javascript_required_for_content !== false ||
    manifest.reversible_back_scrolling !== true ||
    manifest.patient_ready !== false ||
    !same(manifest.scene_order, EXPECTED_SCENES)
  ) {
    throw new Error("scrollytelling accessibility contract failed");
  }
  return true;
}
