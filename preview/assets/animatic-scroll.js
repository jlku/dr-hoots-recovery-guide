import { FRAMES, renderFrame } from "./frames.js";
import { GUIDE_DATA } from "./guide-data.js";

const CARD_IDS = ["wound-dressing", "call-redness", "act-programming"];
const CARD_BEATS = {
  "wound-dressing": [
    { label: "Remove the bandage", sentenceIds: ["wc.01"] },
    { label: "Then check behind the ear", sentenceIds: ["wc.02"] }
  ],
  "call-redness": [
    { label: "All three signs together", sentenceIds: ["call.01"] },
    { label: "1 · Red and swollen", sentenceIds: ["call.01a"] },
    { label: "2 · Not better in 1–2 days", sentenceIds: ["call.01b"] },
    { label: "3 · Hurts when touched", sentenceIds: ["call.01c"] }
  ],
  "act-programming": [
    { label: "The audiologist programs the processor", sentenceIds: ["act.02"] },
    { label: "The settings are made for you", sentenceIds: ["act.03"] }
  ]
};

const sentenceText = (id) => {
  for (const module of Object.values(GUIDE_DATA.modules)) {
    if (module.sentences[id]) return module.sentences[id];
  }
  return "";
};

const cardFrames = CARD_IDS.map((id) => FRAMES.find((frame) => frame.id === id)).filter(Boolean);
const stack = document.getElementById("deck-stack");
const track = document.getElementById("scroll-track");
const count = document.getElementById("current-card-number");
const progressFill = document.getElementById("deck-progress-fill");
const progressLabel = document.getElementById("deck-progress-label");
const scrollHint = document.getElementById("scroll-hint");
const scrollHintLabel = document.getElementById("scroll-hint-label");
const cards = [];
const beatNodes = [];

cardFrames.forEach((frame, cardIndex) => {
  const figure = document.createElement("figure");
  figure.className = "deck-card";
  figure.dataset.cardIndex = String(cardIndex);
  figure.dataset.frame = frame.id;
  figure.dataset.beat = "0";
  figure.setAttribute("aria-label", `Card ${String(frame.number).padStart(2, "0")}: ${frame.title}`);

  const visual = renderFrame(frame);
  visual.classList.add("deck-card__visual");
  visual.querySelector(".sc-num")?.remove();
  figure.append(visual);
  stack.append(figure);
  cards.push(figure);

  const beats = CARD_BEATS[frame.id];
  beats.forEach((beat, beatIndex) => {
    const node = document.createElement("article");
    node.className = "scroll-beat";
    node.dataset.cardIndex = String(cardIndex);
    node.dataset.beatIndex = String(beatIndex);
    node.dataset.label = beat.label;

    const heading = document.createElement("h2");
    heading.textContent = `${String(frame.number).padStart(2, "0")} · ${frame.title}`;
    const copy = document.createElement("p");
    copy.textContent = beat.sentenceIds.map(sentenceText).join(" ");
    node.append(heading, copy);
    track.append(node);
    beatNodes.push(node);
  });
});

let activeCardIndex = -1;
let activeBeatIndex = -1;

function setActiveBeat(cardIndex, beatIndex) {
  if (cardIndex === activeCardIndex && beatIndex === activeBeatIndex) return;
  activeCardIndex = cardIndex;
  activeBeatIndex = beatIndex;

  cards.forEach((card, index) => {
    const delta = index - cardIndex;
    card.classList.toggle("is-active", delta === 0);
    card.classList.toggle("is-before", delta < 0);
    card.classList.toggle("is-after", delta > 0);
    card.style.setProperty("--stack-distance", String(Math.min(Math.abs(delta), 2)));
    if (delta === 0) card.dataset.beat = String(beatIndex);
  });

  const frame = cardFrames[cardIndex];
  const beat = CARD_BEATS[frame.id][beatIndex];
  count.textContent = String(cardIndex + 1).padStart(2, "0");
  progressLabel.textContent = `Card ${cardIndex + 1} · ${beat.label}`;
  const totalBeats = CARD_BEATS[frame.id].length;
  progressFill.style.width = `${((beatIndex + 1) / totalBeats) * 100}%`;
  const isComplete = cardIndex === cardFrames.length - 1 && beatIndex === totalBeats - 1;
  scrollHint.classList.toggle("is-complete", isComplete);
  scrollHintLabel.textContent = isComplete ? "End of preview" : "Scroll to continue";
}

function updateFromScroll() {
  const trigger = window.innerHeight * 0.58;
  let selected = beatNodes[0];
  beatNodes.forEach((node) => {
    if (node.getBoundingClientRect().top <= trigger) selected = node;
  });
  setActiveBeat(Number(selected.dataset.cardIndex), Number(selected.dataset.beatIndex));
}

function updateViewportGeometry() {
  const height = window.innerHeight;
  const width = window.innerWidth;
  const barHeight = document.querySelector(".deck-bar").getBoundingClientRect().height;
  document.documentElement.style.setProperty("--bar-height", `${Math.round(barHeight)}px`);
  document.documentElement.style.setProperty("--stage-height", `${Math.max(520, height - barHeight)}px`);
  document.documentElement.style.setProperty("--trigger-offset", `${Math.max(0, Math.round((height * 0.58) - barHeight))}px`);
  document.documentElement.style.setProperty("--beat-distance", `${Math.max(460, Math.round(height * (width <= 700 ? 0.82 : 0.74)))}px`);
  updateFromScroll();
}

let scrollFrame = 0;
window.addEventListener("scroll", () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateFromScroll();
  });
}, { passive: true });

let resizeFrame = 0;
window.addEventListener("resize", () => {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    updateViewportGeometry();
  });
}, { passive: true });

updateViewportGeometry();
setActiveBeat(0, 0);
