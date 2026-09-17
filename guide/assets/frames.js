// guide/assets/frames.js
// Renders one frame into the diagram stage: an SVG card, an illustration, or live text.
import { assetUrl } from "./data.js";

export function renderFrame(frame, { beat, sentences, pack }) {
  const stage = document.createElement("div");
  stage.className = `frame frame--${frame.kind}`;
  if (frame.kind === "text") {
    const card = document.createElement("div");
    card.className = "text-card";
    if (frame.title_key) {
      const lead = document.createElement("p");
      lead.className = "text-card__lead";
      lead.textContent = pack.labels[frame.title_key] ?? "";
      card.append(lead);
    }
    const list = document.createElement("ul");
    list.className = "text-card__list";
    for (const id of beat?.sentence_ids ?? []) {
      const item = document.createElement("li");
      item.dataset.sentenceId = id;
      item.textContent = sentences.get(id) ?? "";
      list.append(item);
    }
    card.append(list);
    stage.append(card);
    return stage;
  }
  const image = document.createElement("img");
  image.src = assetUrl(frame.src);
  image.alt = frame.alt ?? "";
  image.decoding = "async";
  stage.append(image);
  return stage;
}

export function renderTitleCard(segment, pack) {
  const card = document.createElement("div");
  card.className = "frame frame--title";
  const number = document.createElement("span");
  number.className = "title-card__number";
  number.textContent = String(segment.number).padStart(2, "0");
  const title = document.createElement("h2");
  title.className = "title-card__title";
  title.textContent = pack.labels[segment.title_key] ?? "";
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = pack.labels[segment.chip_key] ?? "";
  card.append(number, title, chip);
  return card;
}
