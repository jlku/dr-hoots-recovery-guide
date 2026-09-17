// guide/assets/player.js
import { assetUrl, fetchJson, loadGuide } from "./data.js";
import { renderFrame, renderTitleCard } from "./frames.js";
import {
  LANGUAGES,
  activeBeat,
  activeCue,
  activeWordIndex,
  assignWordsToCues,
  availableLanguages,
  buildFragment,
  formatTime,
  normalizeLanguage,
  parseFragment,
  pendingConditionalBeats,
  pickEntry,
  segmentByNumber
} from "./logic.js";

const SUBTITLES_KEY = "recovery-guide-subtitles";
const SEEK_STEP_SECONDS = 5;

const dom = {
  titleStrip: document.querySelector("#title-strip"),
  stage: document.querySelector("#stage"),
  caption: document.querySelector("#caption"),
  captionBand: document.querySelector("#caption-band"),
  audio: document.querySelector("#audio"),
  play: document.querySelector("#play-toggle"),
  scrubber: document.querySelector("#scrubber"),
  time: document.querySelector("#time"),
  speed: document.querySelector("#speed"),
  speedLabel: document.querySelector("#speed-label"),
  subtitles: document.querySelector("#subtitles-toggle"),
  subtitlesLabel: document.querySelector("#subtitles-label"),
  language: document.querySelector("#language"),
  languageLabel: document.querySelector("#language-label"),
  prev: document.querySelector("#segment-prev"),
  next: document.querySelector("#segment-next"),
  status: document.querySelector("#status"),
  transcript: document.querySelector("#transcript"),
  transcriptSummary: document.querySelector("#transcript-summary"),
  contentsLink: document.querySelector("#contents-link")
};

let state = null;
let frameId = null;
let cueId = null;
let wordsByCue = new Map();
let rafHandle = 0;

function readPreference() {
  try {
    return localStorage.getItem(SUBTITLES_KEY) !== "off";
  } catch {
    return true;
  }
}

function writePreference(on) {
  try {
    localStorage.setItem(SUBTITLES_KEY, on ? "on" : "off");
  } catch {
    /* per-viewer convenience only */
  }
}

function setStatus(messages) {
  dom.status.replaceChildren(...messages.map((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }));
}

function ensureFrame(id, build) {
  if (frameId === id) return;
  frameId = id;
  dom.stage.replaceChildren(build());
}

function renderCue(cue) {
  cueId = cue?.id ?? null;
  const words = cue ? wordsByCue.get(cue.id) ?? [] : [];
  dom.caption.replaceChildren(...words.map((word) => {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = word.text;
    return span;
  }));
}

function syncToTime(seconds) {
  const { timeline, segment, pack, sentences, frames } = state;
  const beat = activeBeat(timeline, seconds);
  if (!beat) {
    ensureFrame("title", () => renderTitleCard(segment, pack));
  } else {
    ensureFrame(beat.id, () => renderFrame(frames.frames[beat.frame], {
      beat: segment.beats.find((item) => item.id === beat.id),
      sentences,
      pack
    }));
  }
  const cue = activeCue(timeline, seconds);
  if ((cue?.id ?? null) !== cueId) renderCue(cue);
  if (cue) {
    const index = activeWordIndex(wordsByCue.get(cue.id) ?? [], seconds);
    dom.caption.querySelectorAll(".word").forEach((span, position) => span.classList.toggle("is-active", position === index));
  }
  dom.scrubber.value = String(Math.round(seconds * 1000));
  dom.time.textContent = `${formatTime(seconds)} / ${formatTime(timeline.duration_seconds)}`;
}

function tick() {
  syncToTime(dom.audio.currentTime);
  if (!dom.audio.paused && !dom.audio.ended) rafHandle = requestAnimationFrame(tick);
}

function updatePlayLabel() {
  const labels = state.pack.labels;
  const playing = !dom.audio.paused && !dom.audio.ended;
  dom.play.textContent = playing ? labels["ui.pause"] : dom.audio.ended ? labels["ui.replay"] : labels["ui.play"];
  dom.play.setAttribute("aria-pressed", String(playing));
}

function renderLanguages(guide) {
  const available = availableLanguages(guide.index);
  dom.language.replaceChildren(...LANGUAGES.map((language) => {
    const option = document.createElement("option");
    option.value = language.code;
    option.disabled = !available.includes(language.code);
    option.textContent = option.disabled ? `${language.label} · ${guide.pack.labels["ui.coming"]}` : language.label;
    option.selected = language.code === guide.language;
    return option;
  }));
}

function navigate(params) {
  location.hash = buildFragment(params);
}

async function init() {
  cancelAnimationFrame(rafHandle);
  dom.audio.pause();
  const params = parseFragment(location.hash);
  const number = Number.parseInt(params.s ?? "1", 10) || 1;
  const guide = await loadGuide(params.l);
  const labels = guide.pack.labels;
  const segment = segmentByNumber(guide.segments, number) ?? guide.segments.segments[0];
  const picked = pickEntry(guide.index, segment.number, guide.language);
  if (!picked.entry) {
    setStatus([labels["ui.notice"], `No media is built for segment ${segment.number}.`]);
    return;
  }
  const timeline = await fetchJson(picked.entry.timeline);
  wordsByCue = assignWordsToCues(timeline);
  frameId = null;
  cueId = null;
  state = { ...guide, segment, timeline, entry: picked.entry, params };

  document.documentElement.lang = guide.pack.language;
  document.title = `${labels[segment.title_key]} · ${labels["guide.title"]}`;
  dom.titleStrip.replaceChildren(renderTitleCard(segment, guide.pack));
  dom.audio.src = assetUrl(picked.entry.audio);
  dom.audio.playbackRate = Number(dom.speed.value);
  dom.scrubber.max = String(Math.round(timeline.duration_seconds * 1000));
  dom.scrubber.setAttribute("aria-label", labels["ui.seek"]);
  dom.speedLabel.textContent = labels["ui.speed"];
  dom.subtitlesLabel.textContent = labels["ui.subtitles"];
  dom.languageLabel.textContent = labels["ui.language"];
  dom.transcriptSummary.textContent = labels["ui.transcript"];
  dom.prev.textContent = labels["ui.previous"];
  dom.next.textContent = labels["ui.next"];
  dom.contentsLink.textContent = labels["ui.contents"];
  dom.contentsLink.href = `index.html${buildFragment({ ...params, s: undefined })}`;
  renderLanguages(guide);

  const subtitlesOn = readPreference();
  dom.subtitles.checked = subtitlesOn;
  dom.captionBand.hidden = !subtitlesOn;

  const total = guide.segments.segments.length;
  dom.prev.disabled = segment.number <= 1;
  dom.next.disabled = segment.number >= total;

  dom.transcript.replaceChildren(...timeline.beats.map((beat) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = beat.text;
    return paragraph;
  }));

  const messages = [labels["ui.notice"]];
  if (picked.fallback || guide.packFallback) messages.push(labels["ui.language_fallback"]);
  if (pendingConditionalBeats(segment).length) messages.push(labels["ui.pending_clinician_text"]);
  setStatus(messages);

  syncToTime(0);
  updatePlayLabel();
  window.__guidePlayer = {
    getState: () => ({
      segment: segment.id,
      language: guide.language,
      duration: timeline.duration_seconds,
      currentTime: dom.audio.currentTime,
      frame: frameId,
      cue: cueId,
      subtitles: !dom.captionBand.hidden
    })
  };
}

function showError(error) {
  setStatus([error.message]);
}

dom.play.addEventListener("click", () => {
  if (dom.audio.paused || dom.audio.ended) dom.audio.play().catch(showError);
  else dom.audio.pause();
});
dom.audio.addEventListener("play", () => {
  updatePlayLabel();
  cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(tick);
});
dom.audio.addEventListener("pause", () => {
  updatePlayLabel();
  syncToTime(dom.audio.currentTime);
});
dom.audio.addEventListener("ended", () => {
  updatePlayLabel();
  syncToTime(state.timeline.duration_seconds);
});
dom.audio.addEventListener("seeked", () => syncToTime(dom.audio.currentTime));
dom.scrubber.addEventListener("input", () => {
  dom.audio.currentTime = Number(dom.scrubber.value) / 1000;
  syncToTime(dom.audio.currentTime);
});
dom.speed.addEventListener("change", () => {
  dom.audio.playbackRate = Number(dom.speed.value);
});
dom.subtitles.addEventListener("change", () => {
  dom.captionBand.hidden = !dom.subtitles.checked;
  writePreference(dom.subtitles.checked);
});
dom.language.addEventListener("change", () => navigate({ ...state.params, l: normalizeLanguage(dom.language.value) }));
dom.prev.addEventListener("click", () => navigate({ ...state.params, s: state.segment.number - 1 }));
dom.next.addEventListener("click", () => navigate({ ...state.params, s: state.segment.number + 1 }));
document.addEventListener("keydown", (event) => {
  if (!state || event.target.matches("input, select, textarea, button, summary")) return;
  const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
  if (isSpace) {
    event.preventDefault();
    dom.play.click();
  } else if (event.key === "ArrowRight") {
    dom.audio.currentTime = Math.min(state.timeline.duration_seconds, dom.audio.currentTime + SEEK_STEP_SECONDS);
  } else if (event.key === "ArrowLeft") {
    dom.audio.currentTime = Math.max(0, dom.audio.currentTime - SEEK_STEP_SECONDS);
  }
});
window.addEventListener("hashchange", () => init().catch(showError));
init().catch(showError);
