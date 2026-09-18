// guide/assets/frames.js
// Renders one frame into the diagram stage: a composite of anatomy layers with deterministic SVG
// overlays on the narration clock, an illustration, an SVG card, or live text.
import { assetUrl } from "./data.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW = { w: 1000, h: 750 };
const NAVY = "#052049";
const TEAL = "#14828c";
const YELLOW = "#feb80a";
const RED = "#b3261e";
const FLUSH = "#e2574a";
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function phraseTime(words, phrase) {
  if (!phrase || !words?.length) return null;
  const target = normalize(phrase).split(" ").filter(Boolean);
  if (!target.length) return null;
  for (let index = 0; index <= words.length - target.length; index += 1) {
    if (target.every((token, offset) => normalize(words[index + offset].text) === token)) return words[index].start;
  }
  return null;
}

function svg(name, attributes = {}, children = []) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  for (const child of children) node.append(child);
  return node;
}

function wrapLines(text, size, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (next.length * size * 0.52 > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function label(x, y, text, { size = 30, weight = 700, fill = NAVY, anchor = "start", maxWidth = 380 } = {}) {
  const group = svg("g");
  wrapLines(text, size, maxWidth).forEach((content, index) => {
    const node = svg("text", { x, y: y + index * size * 1.25, "font-size": size, "font-weight": weight, fill, "text-anchor": anchor, "font-family": FONT });
    node.textContent = content;
    group.append(node);
  });
  return group;
}

function point(frame, ref) {
  const anchor = typeof ref === "string" ? frame.anchors?.[ref] : ref;
  return { x: (anchor?.x ?? 0.5) * VIEW.w, y: (anchor?.y ?? 0.5) * VIEW.h };
}

function tapeStrip(x, y, width, angle) {
  return svg("g", { transform: `translate(${x} ${y}) rotate(${angle})` }, [
    svg("rect", { x: -width / 2, y: -22, width, height: 44, rx: 8, fill: "#f4e3b3", stroke: NAVY, "stroke-width": 4 }),
    svg("line", { x1: -width / 2 + 16, y1: 0, x2: width / 2 - 16, y2: 0, stroke: NAVY, "stroke-width": 2, "stroke-dasharray": "6 8" })
  ]);
}

function drawDevice(frame, overlay) {
  // A behind-the-ear speech processor: the hook rides over the top of the ear, the body hangs behind
  // the ear (toward the back of the head, which is to the left in the masters), and a short cable runs
  // up to the transmitter coil on the scalp above and behind the ear.
  const ear = point(frame, overlay.anchor);
  const coil = point(frame, overlay.coil);
  const body = svg("path", {
    d: `M ${ear.x} ${ear.y - 8} c -30 -10 -66 10 -66 50 c 0 46 20 86 44 118 c 8 10 22 6 24 -6 c -6 -34 -18 -70 -18 -104 c 0 -20 6 -40 16 -58 z`,
    fill: "#3b3f46",
    stroke: "#20232a",
    "stroke-width": 3,
    "stroke-linejoin": "round"
  });
  const hook = svg("path", { d: `M ${ear.x - 4} ${ear.y - 10} q 18 -16 34 6`, fill: "none", stroke: "#3b3f46", "stroke-width": 9, "stroke-linecap": "round" });
  const cable = svg("path", { d: `M ${ear.x - 20} ${ear.y - 14} Q ${(ear.x + coil.x) / 2 - 20} ${Math.min(ear.y, coil.y) - 50} ${coil.x} ${coil.y}`, fill: "none", stroke: "#3b3f46", "stroke-width": 6, "stroke-linecap": "round" });
  const disc = svg("g", {}, [
    svg("circle", { cx: coil.x, cy: coil.y, r: 30, fill: "#3b3f46", stroke: "#20232a", "stroke-width": 3 }),
    svg("circle", { cx: coil.x, cy: coil.y, r: 12, fill: "none", stroke: "#8a8f99", "stroke-width": 3 })
  ]);
  return svg("g", {}, [cable, body, hook, disc]);
}

function drawOverlay(overlay, frame, layers, labels, register, words) {
  const group = svg("g", { class: `overlay overlay--${overlay.type}` });
  const at = point(frame, overlay.at ?? overlay.anchor);
  const anchor = point(frame, overlay.anchor ?? overlay.at);
  if (overlay.type === "tape-strip") {
    group.append(tapeStrip(anchor.x, anchor.y, overlay.width ?? 150, overlay.angle ?? -25));
  } else if (overlay.type === "inset") {
    const radius = (overlay.radius ?? 0.18) * VIEW.h;
    const scale = overlay.scale ?? 2;
    const clipId = `clip-${frame.id ?? "frame"}-${overlay.id}`;
    const clip = svg("clipPath", { id: clipId }, [svg("circle", { cx: at.x, cy: at.y, r: radius })]);
    const image = svg("image", {
      href: layers.base ?? Object.values(layers)[0],
      x: at.x - anchor.x * scale,
      y: at.y - anchor.y * scale,
      width: VIEW.w * scale,
      height: VIEW.h * scale,
      preserveAspectRatio: "none",
      "clip-path": `url(#${clipId})`
    });
    group.append(clip, image);
    if (overlay.tape) group.append(svg("g", { "clip-path": `url(#${clipId})` }, [tapeStrip(at.x, at.y, 70 * scale, -70)]));
    group.append(svg("circle", { cx: at.x, cy: at.y, r: radius, fill: "none", stroke: NAVY, "stroke-width": 6 }));
    group.append(svg("line", { x1: anchor.x, y1: anchor.y, x2: at.x + radius * 0.7, y2: at.y + radius * 0.7, stroke: NAVY, "stroke-width": 4 }));
    if (overlay.label_key) group.append(label(at.x, at.y + radius + 44, labels[overlay.label_key] ?? "", { anchor: "middle", size: 32 }));
  } else if (overlay.type === "no-cleaning") {
    group.append(
      svg("rect", { x: at.x - 40, y: at.y - 70, width: 80, height: 130, rx: 14, fill: "#e8eef2", stroke: NAVY, "stroke-width": 4 }),
      svg("rect", { x: at.x - 18, y: at.y - 96, width: 36, height: 30, rx: 6, fill: "#e8eef2", stroke: NAVY, "stroke-width": 4 }),
      svg("circle", { cx: at.x, cy: at.y, r: 100, fill: "none", stroke: RED, "stroke-width": 12 }),
      svg("line", { x1: at.x - 70, y1: at.y - 70, x2: at.x + 70, y2: at.y + 70, stroke: RED, "stroke-width": 12, "stroke-linecap": "round" })
    );
    if (overlay.label_key) group.append(label(at.x, at.y + 150, labels[overlay.label_key] ?? "", { anchor: "middle", size: 28, maxWidth: 360 }));
  } else if (overlay.type === "checklist" || overlay.type === "rows" || overlay.type === "steps") {
    (overlay.rows ?? []).forEach((row, index) => {
      const y = at.y + index * 104;
      const rowGroup = svg("g");
      if (overlay.type === "checklist") {
        rowGroup.append(svg("rect", { x: at.x, y: y - 26, width: 44, height: 44, rx: 8, fill: "#fff", stroke: NAVY, "stroke-width": 4 }));
        const check = svg("path", { d: `M ${at.x + 9} ${y - 3} l 11 12 l 18 -24`, fill: "none", stroke: TEAL, "stroke-width": 7, "stroke-linecap": "round", "stroke-linejoin": "round" });
        rowGroup.append(check);
        register(check, phraseTime(words, row.from), null);
      } else if (overlay.type === "steps") {
        rowGroup.append(svg("circle", { cx: at.x + 22, cy: y - 4, r: 24, fill: NAVY }));
        const number = svg("text", { x: at.x + 22, y: y + 7, "font-size": 30, "font-weight": 800, fill: "#fff", "text-anchor": "middle", "font-family": FONT });
        number.textContent = String(index + 1);
        rowGroup.append(number);
      } else {
        rowGroup.append(svg("rect", { x: at.x, y: y - 18, width: 16, height: 32, rx: 4, fill: YELLOW }));
      }
      rowGroup.append(label(at.x + 64, y + 6, labels[row.label_key] ?? "", { size: 27, maxWidth: 330 }));
      group.append(rowGroup);
      if (overlay.type !== "checklist") register(rowGroup, phraseTime(words, row.from), null);
    });
  } else if (overlay.type === "pointer") {
    const text = labels[overlay.label_key] ?? "";
    const size = 25;
    const width = Math.min(440, Math.max(200, text.length * 14));
    const lines = wrapLines(text, size, width - 28);
    const height = 26 + lines.length * size * 1.25;
    group.append(
      svg("line", { x1: anchor.x, y1: anchor.y, x2: at.x, y2: at.y, stroke: NAVY, "stroke-width": 4 }),
      svg("circle", { cx: anchor.x, cy: anchor.y, r: 10, fill: TEAL, stroke: "#fff", "stroke-width": 3 }),
      svg("rect", { x: at.x - width / 2, y: at.y - height / 2, width, height, rx: 8, fill: "#fff", stroke: NAVY, "stroke-width": 3 }),
      label(at.x, at.y - height / 2 + 13 + size * 0.85, text, { anchor: "middle", size, maxWidth: width - 28 })
    );
  } else if (overlay.type === "device") {
    group.append(drawDevice(frame, overlay));
  } else if (overlay.type === "flush") {
    const id = `flush-${frame.id ?? "frame"}-${overlay.id}`;
    const gradient = svg("radialGradient", { id }, [
      svg("stop", { offset: "0%", "stop-color": FLUSH, "stop-opacity": overlay.opacity ?? 0.6 }),
      svg("stop", { offset: "60%", "stop-color": FLUSH, "stop-opacity": (overlay.opacity ?? 0.6) * 0.55 }),
      svg("stop", { offset: "100%", "stop-color": FLUSH, "stop-opacity": 0 })
    ]);
    group.append(svg("defs", {}, [gradient]), svg("ellipse", { cx: anchor.x, cy: anchor.y, rx: (overlay.rx ?? 0.14) * VIEW.w, ry: (overlay.ry ?? 0.16) * VIEW.h, fill: `url(#${id})` }));
  }
  return group;
}

function renderComposite(frame, { beatWords, pack }) {
  const root = document.createElement("div");
  root.className = "frame frame--composite";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", frame.alt ?? "");
  const box = document.createElement("div");
  box.className = "composite";
  const schedule = [];
  const register = (node, from, until) => schedule.push({ node, from, until });
  const layers = Object.fromEntries(Object.entries(frame.layers ?? {}).map(([name, file]) => [name, assetUrl(file)]));
  const states = frame.states?.length ? frame.states : [{ id: "base", image: Object.keys(layers)[0] }];
  for (const state of states) {
    const image = document.createElement("img");
    image.className = "composite__image";
    image.src = layers[state.image];
    image.alt = "";
    image.decoding = "async";
    box.append(image);
    register(image, phraseTime(beatWords, state.from), phraseTime(beatWords, state.until));
  }
  const tint = svg("svg", { class: "composite__tint", viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, "aria-hidden": "true" });
  const overlay = svg("svg", { class: "composite__overlay", viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, "aria-hidden": "true" });
  for (const item of frame.overlays ?? []) {
    const group = drawOverlay(item, frame, layers, pack.labels, register, beatWords);
    (item.type === "flush" ? tint : overlay).append(group);
    register(group, phraseTime(beatWords, item.from), phraseTime(beatWords, item.until));
  }
  box.append(tint, overlay);
  root.append(box);
  root.__schedule = schedule;
  updateFrame(root, 0);
  return root;
}

export function updateFrame(root, seconds) {
  for (const item of root?.__schedule ?? []) {
    const on = (item.from == null || seconds >= item.from) && (item.until == null || seconds < item.until);
    if (item.node instanceof HTMLImageElement) item.node.style.opacity = on ? "1" : "0";
    else item.node.setAttribute("visibility", on ? "visible" : "hidden");
  }
}

function pendingMarker(pending, pack) {
  const marker = document.createElement("p");
  marker.className = "frame__pending";
  marker.textContent = `${pack.labels["ov.pending_howto"] ?? "How-to picture pending"}: ${pending.map((claim) => claim.action).join("; ")}`;
  return marker;
}

export function renderFrame(frame, { beat, beatWords = [], sentences, pack, pending = [] }) {
  const root = renderFrameBody(frame, { beat, beatWords, sentences, pack });
  if (pending.length) root.append(pendingMarker(pending, pack));
  return root;
}

function renderFrameBody(frame, { beat, beatWords = [], sentences, pack }) {
  if (frame.kind === "composite") return renderComposite(frame, { beatWords, pack });
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
