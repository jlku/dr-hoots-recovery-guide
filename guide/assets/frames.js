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
// A closed cut a few days old, in a muted brown a little darker than the drawing's own outlines.
// A soft pink line read as redness, the warning sign, and a dark red one as a bleeding cut.
const INCISION = "#7d645f";
const FONT = "'Helvetica Neue', Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif";
// Chinese characters and full-width punctuation are about one em wide; Latin letters about half.
const WIDE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/u;
const CLOSING = /^[，。、；：！？）」』”’]/u;

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

// Width in drawing units: a Latin character is \`latinEm\` of the font size, a Chinese character a full
// em. Latin text measures exactly as it did before Chinese was supported.
function measure(text, size, latinEm) {
  let latin = 0;
  let wide = 0;
  for (const character of text) {
    if (WIDE.test(character)) wide += 1;
    else latin += 1;
  }
  return latin * size * latinEm + wide * size;
}

export function textWidth(text, size) {
  return measure(text, size, 0.52);
}

export function wrapLines(text, size, maxWidth) {
  // Spaced text wraps between words. Chinese wraps between characters, keeps runs of Latin letters
  // and digits together, and never starts a line with closing punctuation.
  const spaced = !WIDE.test(text);
  // A no-break space joins a number to its unit, so 101.5 °F never splits across lines.
  const units = spaced ? text.split(" ") : text.match(/[A-Za-z0-9.,°%+\u00a0-]+|\s+|./gu) ?? [];
  const joiner = spaced ? " " : "";
  const lines = [];
  let line = "";
  for (const unit of units) {
    if (!spaced && /^\s+$/.test(unit) && !line) continue;
    const next = line ? `${line}${joiner}${unit}` : unit;
    if (textWidth(next, size) > maxWidth && line && !CLOSING.test(unit)) {
      lines.push(line);
      line = unit.trim();
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function label(x, y, text, { size = 30, weight = 700, fill = NAVY, anchor = "start", maxWidth = 380, halo = false } = {}) {
  const group = svg("g");
  // A halo keeps a label readable where it crosses the drawing.
  const outline = halo ? { stroke: "#fff", "stroke-width": size * 0.22, "stroke-linejoin": "round", "paint-order": "stroke" } : {};
  wrapLines(text, size, maxWidth).forEach((content, index) => {
    const node = svg("text", { x, y: y + index * size * 1.25, "font-size": size, "font-weight": weight, fill, "text-anchor": anchor, "font-family": FONT, ...outline });
    node.textContent = content;
    group.append(node);
  });
  return group;
}

function point(frame, ref) {
  const anchor = typeof ref === "string" ? frame.anchors?.[ref] : ref;
  return { x: (anchor?.x ?? 0.5) * VIEW.w, y: (anchor?.y ?? 0.5) * VIEW.h };
}

// A named path in image space, such as the incision, measured from the accepted image.
function pathPoints(frame, name) {
  return (frame.paths?.[name] ?? []).map(([x, y]) => ({ x: x * VIEW.w, y: y * VIEW.h }));
}

// The point a fraction t of the way along a path, by length, with the path's direction there.
function along(points, t) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let remaining = Math.max(0, Math.min(1, t)) * lengths.reduce((sum, length) => sum + length, 0);
  for (let index = 1; index < points.length; index += 1) {
    const length = lengths[index - 1];
    if (remaining <= length || index === points.length - 1) {
      const share = length ? Math.min(remaining / length, 1) : 0;
      const [from, to] = [points[index - 1], points[index]];
      return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share, angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI };
    }
    remaining -= length;
  }
  return { ...points[0], angle: 0 };
}

// A smooth curve through measured points (Catmull-Rom, drawn as cubic Béziers).
function smoothPath(points) {
  const r = (value) => Math.round(value * 10) / 10;
  let d = `M ${r(points[0].x)} ${r(points[0].y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [p0, p1, p2, p3] = [points[index - 1] ?? points[index], points[index], points[index + 1], points[index + 2] ?? points[index + 1]];
    d += ` C ${r(p1.x + (p2.x - p0.x) / 6)} ${r(p1.y + (p2.y - p0.y) / 6)} ${r(p2.x - (p3.x - p1.x) / 6)} ${r(p2.y - (p3.y - p1.y) / 6)} ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

// Wound-closure tape as it is applied: a few short strips laid across the cut, thin and slightly
// see-through, with a soft shadow so they read as lying on the skin. The single opaque strip with a
// navy outline that this replaces was read by two of three observers as something stuck in the skin.
function tapeStrips(points, { count = 3, span = [0.2, 0.8], length = 46, width = 16 } = {}) {
  const group = svg("g", { class: "tape-strips" });
  if (points.length < 2) return group;
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? (span[0] + span[1]) / 2 : span[0] + ((span[1] - span[0]) * index) / (count - 1);
    const at = along(points, t);
    const across = at.angle + 90;
    const rect = { x: -length / 2, y: -width / 2, width: length, height: width, rx: 3 };
    group.append(
      svg("g", { transform: `translate(${at.x + 1.5} ${at.y + 2.5}) rotate(${across})` }, [svg("rect", { ...rect, fill: "#5a3c28", "fill-opacity": 0.16 })]),
      svg("g", { transform: `translate(${at.x} ${at.y}) rotate(${across})` }, [svg("rect", { ...rect, fill: "#fdfaf2", "fill-opacity": 0.86, stroke: "#bfae94", "stroke-width": 1.4 })])
    );
  }
  return group;
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

function drawOverlay(overlay, frame, layers, labels, register, when) {
  const group = svg("g", { class: `overlay overlay--${overlay.type}` });
  const at = point(frame, overlay.at ?? overlay.anchor);
  const anchor = point(frame, overlay.anchor ?? overlay.at);
  if (overlay.type === "incision") {
    // The incision is drawn here rather than generated: three image edits in a row drew tick marks,
    // a pink glow, or a loop onto the neck. A measured path gives the same line in every panel.
    const points = pathPoints(frame, overlay.path);
    if (points.length >= 2) group.append(svg("path", { d: smoothPath(points), fill: "none", stroke: INCISION, "stroke-width": overlay.width ?? 4.2, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  } else if (overlay.type === "tape-strips") {
    group.append(tapeStrips(pathPoints(frame, overlay.path), { count: overlay.count, span: overlay.span, length: overlay.length, width: overlay.width }));
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
    // Without words the crossed-out bottle read as "don't take your medicine" to three of three observers.
    if (overlay.label_key) group.append(label(at.x, at.y + 150, labels[overlay.label_key] ?? "", { anchor: "middle", size: 28, maxWidth: 360, halo: true }));
  } else if (overlay.type === "checklist" || overlay.type === "rows" || overlay.type === "steps") {
    // Each row takes the room its wrapped label needs, so a long row never runs into the next.
    const rowSize = 30;
    const rowWidth = 360;
    let y = at.y;
    (overlay.rows ?? []).forEach((row, index) => {
      if (index > 0) y += Math.max(110, 40 + wrapLines(labels[overlay.rows[index - 1].label_key] ?? "", rowSize, rowWidth).length * rowSize * 1.25);
      const rowGroup = svg("g");
      if (overlay.type === "checklist") {
        rowGroup.append(svg("rect", { x: at.x, y: y - 26, width: 44, height: 44, rx: 8, fill: "#fff", stroke: NAVY, "stroke-width": 4 }));
        const check = svg("path", { d: `M ${at.x + 9} ${y - 3} l 11 12 l 18 -24`, fill: "none", stroke: TEAL, "stroke-width": 7, "stroke-linecap": "round", "stroke-linejoin": "round" });
        rowGroup.append(check);
        register(check, when(row.from), null);
      } else if (overlay.type === "steps") {
        rowGroup.append(svg("circle", { cx: at.x + 22, cy: y - 4, r: 24, fill: NAVY }));
        const number = svg("text", { x: at.x + 22, y: y + 7, "font-size": 30, "font-weight": 800, fill: "#fff", "text-anchor": "middle", "font-family": FONT });
        number.textContent = String(index + 1);
        rowGroup.append(number);
      } else {
        rowGroup.append(svg("rect", { x: at.x, y: y - 18, width: 16, height: 32, rx: 4, fill: YELLOW }));
      }
      rowGroup.append(label(at.x + 64, y + 6, labels[row.label_key] ?? "", { size: rowSize, maxWidth: rowWidth, halo: true }));
      group.append(rowGroup);
      if (overlay.type !== "checklist") register(rowGroup, when(row.from), null);
    });
  } else if (overlay.type === "pointer") {
    const text = labels[overlay.label_key] ?? "";
    const size = 29;
    // Sized to the text plus its padding, so the last word or character never wraps alone.
    const width = Math.min(480, Math.max(220, measure(text, size, 16 / size) + 28));
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
  } else if (overlay.type === "motion-arrow") {
    // Direction of an action. A still of a hand and gauze reads the same forwards and backwards;
    // the arrow is what says which way it goes. It runs from the named anchor to `at`.
    const dx = at.x - anchor.x;
    const dy = at.y - anchor.y;
    const length = Math.hypot(dx, dy) || 1;
    const bend = (overlay.bend ?? 0.25) * length;
    const control = { x: (anchor.x + at.x) / 2 - (dy / length) * bend, y: (anchor.y + at.y) / 2 + (dx / length) * bend };
    const angle = Math.atan2(at.y - control.y, at.x - control.x);
    const head = overlay.head ?? 54;
    const weight = overlay.weight ?? 14;
    const spread = 0.5;
    const shaftEnd = { x: at.x - Math.cos(angle) * head * 0.7, y: at.y - Math.sin(angle) * head * 0.7 };
    const corner = (sign) => `${at.x - head * Math.cos(angle + sign * spread)},${at.y - head * Math.sin(angle + sign * spread)}`;
    const shaft = `M ${anchor.x} ${anchor.y} Q ${control.x} ${control.y} ${shaftEnd.x} ${shaftEnd.y}`;
    group.append(
      svg("path", { d: shaft, fill: "none", stroke: "#fff", "stroke-width": weight + 14, "stroke-linecap": "round" }),
      svg("polygon", { points: `${at.x},${at.y} ${corner(1)} ${corner(-1)}`, fill: "#fff", stroke: "#fff", "stroke-width": 14, "stroke-linejoin": "round" }),
      svg("path", { d: shaft, fill: "none", stroke: TEAL, "stroke-width": weight, "stroke-linecap": "round" }),
      svg("polygon", { points: `${at.x},${at.y} ${corner(1)} ${corner(-1)}`, fill: TEAL })
    );
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

function renderComposite(frame, { beatWords, pack, motion }) {
  const root = document.createElement("div");
  root.className = "frame frame--composite";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", frame.alt ?? "");
  const box = document.createElement("div");
  box.className = "composite";
  const schedule = [];
  const register = (node, from, until) => schedule.push({ node, from, until });
  // Static is the default for this version: nothing appears, disappears, or swaps during a beat.
  const when = (phrase) => (motion === "narration" ? phraseTime(beatWords, phrase) : null);
  const layers = Object.fromEntries(Object.entries(frame.layers ?? {}).map(([name, file]) => [name, assetUrl(file)]));
  const states = frame.states?.length ? frame.states : [{ id: "base", image: Object.keys(layers)[0] }];
  for (const state of motion === "narration" ? states : states.slice(0, 1)) {
    const image = document.createElement("img");
    image.className = "composite__image";
    image.src = layers[state.image];
    image.alt = "";
    image.decoding = "async";
    box.append(image);
    register(image, when(state.from), when(state.until));
  }
  const tint = svg("svg", { class: "composite__tint", viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, "aria-hidden": "true" });
  const overlay = svg("svg", { class: "composite__overlay", viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, "aria-hidden": "true" });
  for (const item of frame.overlays ?? []) {
    const group = drawOverlay(item, frame, layers, pack.labels, register, when);
    (item.type === "flush" ? tint : overlay).append(group);
    register(group, when(item.from), when(item.until));
  }
  box.append(tint, overlay);
  root.append(box);
  root.__schedule = schedule;
  updateFrame(root, 0);
  return root;
}

// A static instruction figure in the style of an airline safety card: numbered panels read in
// order, an arrow where something moves, no animation. Each panel is one accepted image, optionally
// zoomed on an anchor, with vector marks drawn in image space and captions as real text below.
function renderPanels(frame, { pack }) {
  const root = document.createElement("div");
  root.className = "frame frame--panels";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", frame.alt ?? "");
  const panels = frame.panels ?? [];
  const columns = frame.columns ?? (panels.length <= 3 ? Math.max(panels.length, 1) : 2);
  const rows = Math.max(Math.ceil(panels.length / columns), 1);
  const listed = panels.some((panel) => panel.caption_keys?.length);
  const titled = panels.some((panel) => panel.title_key);
  const grid = document.createElement("div");
  grid.className = "panels";
  grid.style.setProperty("--columns", String(columns));
  grid.style.setProperty("--aspect", String((4 * columns) / (3 * rows)));
  grid.style.setProperty("--captions", listed ? "120px" : titled ? "40px" : "0px");
  const layers = Object.fromEntries(Object.entries(frame.layers ?? {}).map(([name, file]) => [name, assetUrl(file)]));
  const always = () => null;
  const ignore = () => {};
  panels.forEach((panel, index) => {
    const figure = document.createElement("figure");
    figure.className = "panel";
    const view = svg("svg", { class: "panel__view", viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, "aria-hidden": "true" });
    const clipId = `panel-${frame.id ?? "frame"}-${index}`;
    view.append(svg("clipPath", { id: clipId }, [svg("rect", { x: 0, y: 0, width: VIEW.w, height: VIEW.h, rx: 28 })]));
    const zoomed = svg("g");
    if (panel.zoom) {
      const center = point(frame, panel.zoom.anchor);
      zoomed.setAttribute("transform", `translate(${VIEW.w / 2} ${VIEW.h / 2}) scale(${panel.zoom.scale ?? 2}) translate(${-center.x} ${-center.y})`);
    }
    zoomed.append(svg("image", { href: layers[panel.image], x: 0, y: 0, width: VIEW.w, height: VIEW.h, preserveAspectRatio: "xMidYMid slice" }));
    for (const item of panel.overlays ?? []) zoomed.append(drawOverlay(item, frame, layers, pack.labels, ignore, always));
    if (panel.lens) {
      // A magnifier says "look closely": the zoomed view sits inside a lens with a handle.
      const lens = { x: VIEW.w / 2, y: 318, r: 286 };
      const lensId = `${clipId}-lens`;
      view.append(
        svg("clipPath", { id: lensId }, [svg("circle", { cx: lens.x, cy: lens.y, r: lens.r })]),
        svg("rect", { x: 0, y: 0, width: VIEW.w, height: VIEW.h, rx: 28, fill: "#fbfaf3" }),
        svg("line", { x1: lens.x + lens.r * 0.72, y1: lens.y + lens.r * 0.72, x2: lens.x + lens.r * 1.32, y2: lens.y + lens.r * 1.32, stroke: NAVY, "stroke-width": 58, "stroke-linecap": "round" }),
        svg("g", { "clip-path": `url(#${lensId})` }, [zoomed]),
        svg("circle", { cx: lens.x, cy: lens.y, r: lens.r, fill: "none", stroke: NAVY, "stroke-width": 26 })
      );
      zoomed.setAttribute("transform", `translate(${lens.x} ${lens.y}) scale(${panel.zoom?.scale ?? 2}) translate(${-point(frame, panel.zoom?.anchor).x} ${-point(frame, panel.zoom?.anchor).y})`);
    } else {
      view.append(svg("g", { "clip-path": `url(#${clipId})` }, [zoomed]));
    }
    view.append(svg("rect", { x: 3, y: 3, width: VIEW.w - 6, height: VIEW.h - 6, rx: 28, fill: "none", stroke: "#9fb0bc", "stroke-width": 6 }));
    if (panel.number != null) {
      const numeral = svg("text", { x: 104, y: 138, "font-size": 100, "font-weight": 800, fill: "#fff", "text-anchor": "middle", "font-family": FONT });
      numeral.textContent = String(panel.number);
      view.append(svg("circle", { cx: 104, cy: 104, r: 74, fill: NAVY, stroke: "#fff", "stroke-width": 8 }), numeral);
    }
    if (panel.label_key) {
      // Beside a magnifier the label sits bottom left, so the handle that makes the lens read as a
      // magnifier stays in view.
      const text = pack.labels[panel.label_key] ?? "";
      const size = panel.lens ? 72 : 86;
      const width = Math.min(VIEW.w - 80, measure(text, size, 0.58) + size * 1.28);
      const height = size * 1.44;
      const left = panel.lens ? 36 : (VIEW.w - width) / 2;
      const top = VIEW.h - 40 - height;
      const mark = svg("text", { x: left + width / 2, y: top + height / 2 + size * 0.35, "font-size": size, "font-weight": 800, fill: NAVY, "text-anchor": "middle", "font-family": FONT });
      mark.textContent = text;
      view.append(svg("rect", { x: left, y: top, width, height, rx: height / 2, fill: "#fff", stroke: NAVY, "stroke-width": 6 }), mark);
    }
    figure.append(view);
    if (panel.title_key || panel.caption_keys?.length) {
      const caption = document.createElement("figcaption");
      if (panel.title_key) {
        const title = document.createElement("strong");
        title.textContent = pack.labels[panel.title_key] ?? "";
        caption.append(title);
      }
      if (panel.caption_keys?.length) {
        const list = document.createElement(panel.numbered ? "ol" : "ul");
        for (const key of panel.caption_keys) {
          const item = document.createElement("li");
          item.textContent = pack.labels[key] ?? "";
          list.append(item);
        }
        caption.append(list);
      }
      figure.append(caption);
    }
    grid.append(figure);
  });
  root.append(grid);
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

export function renderFrame(frame, { beat, beatWords = [], sentences, pack, pending = [], motion = "static" }) {
  const root = renderFrameBody(frame, { beat, beatWords, sentences, pack, motion });
  if (pending.length) root.append(pendingMarker(pending, pack));
  return root;
}

function renderFrameBody(frame, { beat, beatWords = [], sentences, pack, motion }) {
  if (frame.kind === "composite") return renderComposite(frame, { beatWords, pack, motion });
  if (frame.kind === "panels") return renderPanels(frame, { pack });
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
