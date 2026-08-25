const contentRoot = document.querySelector("#baseline-content");
const sourceRoot = document.querySelector("#source-list");
const displayTitles = {
  "ci/wound-care": "Care for the surgery site",
  "ci/when-to-call": "When to call",
  "ci/activation": "Your programming visits"
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

try {
  const response = await fetch(new URL("../content/canonical/ci-phase0-v0.1.0.json?v=3", import.meta.url));
  if (!response.ok) throw new Error("The working recovery steps could not be loaded.");
  const canonical = await response.json();

  const sections = canonical.modules.map((module) => {
    const section = element("section", "baseline-module");
    section.id = module.id.replace("/", "-");
    section.append(element("h2", "baseline-module__title", displayTitles[module.id] ?? module.title));
    const list = element("ol", "baseline-steps");
    for (const sentence of module.canonical_sentences) {
      const item = element("li", "baseline-step", sentence.text);
      item.dataset.sentenceId = sentence.id;
      list.append(item);
    }
    section.append(list);
    return section;
  });
  contentRoot.replaceChildren(...sections);

  const sources = canonical.sources.map((source) => {
    const item = element("p", "source-item");
    const link = element("a", "source-link", source.title);
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    item.append(link, document.createTextNode(` — ${source.publisher}`));
    return item;
  });
  sourceRoot.replaceChildren(...sources);
} catch (error) {
  contentRoot.replaceChildren(element("p", "baseline-error", error.message));
}
