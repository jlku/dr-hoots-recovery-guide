// guide/assets/export.js
// The 9:16 export canvas. It draws a fixed segment at any moment of its narration with the guide's own
// frames, timeline, and captions, and exposes renderAt(seconds) for scripts/export-segments.mjs.
import { fetchJson, loadGuide } from "./data.js";
import { renderFrame, updateFrame } from "./frames.js";
import { activeBeat, activeCue, activeWordIndex, assignWordsToCues, exportChangePoints, fixedSegments } from "./logic.js";

const params = new URLSearchParams(location.search);
const byId = (id) => document.getElementById(id);

function span(className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

async function setup() {
  const number = Number(params.get("segment"));
  const language = params.get("lang") ?? "en";
  const guide = await loadGuide(language);
  if (guide.pack.language !== language) throw new Error(`there is no ${language} pack`);
  const segment = fixedSegments(guide.segments.segments).find((item) => item.number === number);
  if (!segment) throw new Error(`segment ${number} does not export: it is not the same for every patient`);
  const entry = guide.index.entries.find((item) => item.number === number && item.language === language && !item.variant);
  if (!entry) throw new Error(`segment ${number} has no ${language} narration`);
  const timeline = await fetchJson(entry.timeline);
  document.documentElement.lang = language;
  byId("export-number").textContent = String(number).padStart(2, "0");
  byId("export-heading").textContent = guide.pack.labels[segment.title_key] ?? "";
  byId("export-chip").textContent = guide.pack.labels[segment.chip_key] ?? "";
  byId("notice").textContent = guide.pack.labels["ui.notice"] ?? "";
  const cueWords = assignWordsToCues(timeline);
  let shownBeat = null;
  let shownCue;

  // The title strip names the segment, so during the title card the stage already shows its first picture.
  async function renderAt(seconds) {
    const beat = activeBeat(timeline, seconds) ?? timeline.beats[0];
    if (beat.id !== shownBeat) {
      const root = renderFrame({ ...guide.frames.frames[beat.frame], id: beat.frame }, {
        beat: segment.beats.find((item) => item.id === beat.id),
        beatWords: timeline.words.filter((word) => word.beat === beat.id),
        sentences: guide.sentences,
        pack: guide.pack,
        pending: (guide.instructions?.claims ?? []).filter((claim) => claim.frame === beat.frame && claim.status === "placeholder"),
        motion: guide.frames.motion ?? "static"
      });
      root.querySelectorAll(".composite__image").forEach((image) => { image.style.transition = "none"; });
      // Two 4:3 panels side by side fill less than half of a square stage; stacked, each is larger.
      root.querySelectorAll(".panels").forEach((grid) => {
        if (grid.children.length !== 2 || grid.style.getPropertyValue("--columns") !== "2") return;
        grid.style.setProperty("--columns", "1");
        grid.style.setProperty("--aspect", String(4 / 6));
      });
      byId("stage").replaceChildren(root);
      shownBeat = beat.id;
      await Promise.all([...root.querySelectorAll("img")].map((image) => image.decode().catch(() => {})));
      // Shrink the panels until the whole frame, with its captions and any pending note, fits the stage.
      const grids = [...root.querySelectorAll(".panels")];
      for (let reserve = 120; grids.length && reserve <= 600; reserve += 20) {
        grids.forEach((grid) => grid.style.setProperty("--captions", `${reserve}px`));
        if (root.scrollHeight <= root.clientHeight + 1) break;
      }
    }
    updateFrame(byId("stage").firstElementChild, seconds);
    const cue = activeCue(timeline, seconds);
    const caption = byId("caption");
    if ((cue?.id ?? null) !== shownCue) {
      shownCue = cue?.id ?? null;
      const words = cue ? cueWords.get(cue.id) ?? [] : [];
      caption.replaceChildren();
      words.forEach((word, index) => {
        caption.append(span("word", word.text));
        if (index < words.length - 1 && (word.space ?? true)) caption.append(document.createTextNode(" "));
      });
    }
    const active = cue ? activeWordIndex(cueWords.get(cue.id) ?? [], seconds) : -1;
    caption.querySelectorAll(".word").forEach((word, position) => word.classList.toggle("is-active", position === active));
    return { beat: beat.id, cue: shownCue, overflow: caption.scrollHeight > caption.clientHeight + 1 };
  }

  window.renderAt = renderAt;
  return { number, language, slug: segment.id.split("/").pop(), duration: timeline.duration_seconds, points: exportChangePoints(timeline), audio: entry.audio };
}

window.exportReady = setup();
