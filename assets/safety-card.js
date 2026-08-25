const SCENE_LABELS = {
  "scene/wound/dressing": "Dressing and tape check",
  "scene/wound/tape": "If tape is present",
  "scene/wound/no-tape": "If there is no tape",
  "scene/wound/shower": "Showering",
  "scene/wound/follow-up": "Follow-up care",
  "scene/call/redness": "Redness and swelling",
  "scene/call/fever": "Fever",
  "scene/call/fluid": "Swelling or fluid",
  "scene/call/neuro": "Other warning signs",
  "scene/call/concerns": "Questions or concerns",
  "scene/call/contact": "Who to call",
  "scene/activation/healing": "After healing",
  "scene/activation/programming": "First programming visit",
  "scene/activation/follow-up": "Follow-up visits"
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function loadSafetyCardModel() {
  const canonicalUrl = new URL("../content/canonical/ci-phase0-v0.1.0.json?v=3", import.meta.url);
  const scenesUrl = new URL("../content/scenes/ci-phase0-v0.1.0.scenes.json?v=2", import.meta.url);
  const [canonicalResponse, scenesResponse] = await Promise.all([fetch(canonicalUrl), fetch(scenesUrl)]);

  if (!canonicalResponse.ok || !scenesResponse.ok) {
    throw new Error("The canonical recovery-card data could not be loaded.");
  }

  const [canonical, sceneSource] = await Promise.all([canonicalResponse.json(), scenesResponse.json()]);
  const modules = new Map(canonical.modules.map((module) => [module.id, module]));
  const sentences = new Map(
    canonical.modules.flatMap((module) =>
      module.canonical_sentences.map((sentence) => [sentence.id, sentence])
    )
  );

  return {
    artifact: canonical.artifact,
    scenes: sceneSource.scenes.map((scene, index) => ({
      ...scene,
      number: index + 1,
      label: SCENE_LABELS[scene.id] ?? `Scene ${index + 1}`,
      module: modules.get(scene.module_id),
      sentences: scene.sentence_ids.map((sentenceId) => sentences.get(sentenceId))
    }))
  };
}

export async function loadProgrammingPrototype() {
  const adaptationUrl = new URL("../content/adaptations/activation-programming-v0.1.0.json?v=3", import.meta.url);
  const illustrationUrl = new URL("./illustrations/manifest.json?v=2", import.meta.url);
  const [adaptationResponse, illustrationResponse] = await Promise.all([
    fetch(adaptationUrl),
    fetch(illustrationUrl)
  ]);

  if (!adaptationResponse.ok || !illustrationResponse.ok) {
    throw new Error("The programming-scene prototype data could not be loaded.");
  }

  const [adaptation, illustrationManifest] = await Promise.all([
    adaptationResponse.json(),
    illustrationResponse.json()
  ]);
  const illustration = illustrationManifest.assets.find(
    (asset) => asset.scene_id === adaptation.scene_id && asset.renderable_in_private_prototype
  );

  if (!illustration || illustration.patient_use !== false) {
    throw new Error("The private programming illustration is missing or incorrectly classified.");
  }

  return { adaptation, illustration };
}

export function createSafetyCardPanel(scene, options = {}) {
  const {
    showModule = true,
    compact = false,
    display = null,
    illustration = null,
    video = false
  } = options;
  const classes = ["canonical-frame"];
  if (compact) classes.push("canonical-frame--compact");
  if (video) classes.push("canonical-frame--video");
  if (illustration) classes.push("canonical-frame--illustrated");
  const article = element("article", classes.join(" "));
  article.dataset.sceneId = scene.id;
  article.dataset.moduleId = scene.module_id;

  const index = element("div", "canonical-frame__index");
  index.append(element("b", "canonical-frame__number", String(scene.number).padStart(2, "0")));
  index.append(element("span", "canonical-frame__kind", scene.module.title));

  const visual = element("div", "canonical-frame__visual");
  visual.setAttribute(
    "aria-label",
    illustration
      ? "Unreviewed concept illustration of a hearing specialist programming an external speech processor."
      : "Clinical illustration is blocked pending surgeon review. The complete instruction appears as live text."
  );
  const visualField = element("div", "canonical-frame__visual-field");
  if (illustration) {
    const image = document.createElement("img");
    image.className = "canonical-frame__illustration";
    image.src = illustration.file;
    image.alt = illustration.alt;
    image.width = illustration.width;
    image.height = illustration.height;
    visualField.append(image);
    visualField.append(element("span", "canonical-frame__concept-label", "Unreviewed concept art"));
  } else {
    visualField.append(element("span", "canonical-frame__visual-number", String(scene.number).padStart(2, "0")));
    visualField.append(element("span", "canonical-frame__visual-status", "Illustration pending surgeon review"));
  }
  visual.append(visualField);

  if (video) {
    const caption = element("div", "video-caption");
    caption.setAttribute("aria-label", "Visible video caption");
    caption.append(element("span", "video-caption__label", "Caption"));
    const captionText = element("p", "video-caption__text");
    captionText.textContent = (display?.blocks ?? scene.sentences).map((block) => block.text).join(" ");
    caption.append(captionText);
    visualField.append(caption);
  }

  const copy = element("div", "canonical-frame__copy");
  copy.append(element("p", "canonical-frame__module", scene.module.title));
  copy.append(element("h3", "canonical-frame__title", display?.scene_title ?? scene.label));
  const sentenceGroup = element("div", "canonical-frame__sentences");
  for (const sentence of display?.blocks ?? scene.sentences) {
    const paragraph = element("p", "canonical-frame__sentence", sentence.text);
    const sentenceIds = sentence.canonical_sentence_ids ?? [sentence.id];
    paragraph.dataset.sentenceIds = sentenceIds.join(" ");
    if (sentence.proposition_ids) paragraph.dataset.propositionIds = sentence.proposition_ids.join(" ");
    sentenceGroup.append(paragraph);
  }
  copy.append(sentenceGroup);
  copy.append(element("small", "canonical-frame__review", "Unverified draft · not for patient use"));

  article.append(index, visual, copy);
  return article;
}

export function renderSafetyCard(container, scenes, options = {}) {
  const fragment = document.createDocumentFragment();
  for (const scene of scenes) fragment.append(createSafetyCardPanel(scene, options));
  container.replaceChildren(fragment);
}
