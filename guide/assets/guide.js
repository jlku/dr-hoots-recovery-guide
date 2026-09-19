// guide/assets/guide.js
// One page: chapter rail, one continuous player across the segments, synchronized captions,
// and a transcript that follows playback and seeks on tap.
import { assetUrl, fetchJson, loadGuide } from "./data.js";
import { renderFrame, renderTitleCard, updateFrame } from "./frames.js";
import {
  LANGUAGES,
  activeBeat,
  activeCue,
  activeSentence,
  activeWordIndex,
  assignWordsToCues,
  availableLanguages,
  buildFragment,
  buildGuideClock,
  conditionsFor,
  formatFollowUp,
  formatTime,
  globalToLocal,
  localToGlobal,
  normalizeLanguage,
  parseFragment,
  pendingConditionalBeats,
  pickEntry,
  reviewBadges,
  sentenceSpans,
  statusMessages,
  variantFor
} from "./logic.js";

const CAPTIONS_KEY = "recovery-guide-captions";
const FOLLOW_KEY = "recovery-guide-follow";
const SEEK_STEP_SECONDS = 5;
const byId = (id) => document.getElementById(id);
const dom = {
  title: byId("guide-title"),
  language: byId("language"),
  languageLabel: byId("language-label"),
  print: byId("print-link"),
  transportCard: byId("transport-card"),
  chapterList: byId("chapter-list"),
  callBlock: byId("call-block"),
  stage: byId("stage"),
  captionBand: byId("caption-band"),
  caption: byId("caption"),
  audio: byId("audio"),
  play: byId("play-toggle"),
  scrubber: byId("scrubber"),
  ticks: byId("scrubber-ticks"),
  time: byId("time"),
  speed: byId("speed"),
  speedLabel: byId("speed-label"),
  captions: byId("captions-toggle"),
  captionsLabel: byId("captions-label"),
  transcript: byId("transcript"),
  transcriptHeading: byId("transcript-heading"),
  follow: byId("follow-toggle"),
  followLabel: byId("follow-label"),
  chapterPrev: byId("chapter-prev"),
  chapterNext: byId("chapter-next"),
  chapterSelect: byId("chapter-select"),
  chapterCount: byId("chapter-count"),
  status: byId("status")
};

let state = null;
let frameId = null;
let cueKey = null;
let sentenceKey = null;
let chapterNumber = null;
let rafHandle = 0;

const readFlag = (key) => {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
};
const writeFlag = (key, on) => {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    /* per-viewer convenience only */
  }
};
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function labels() {
  return state.guide.pack.labels;
}

function segmentByNumber(number) {
  return state.guide.segments.segments.find((segment) => segment.number === number) ?? null;
}

function entryFor(number) {
  return pickEntry(state.guide.index, number, state.guide.language, state.variant).entry;
}

function currentOffset() {
  return state.clock.segments.find((segment) => segment.number === state.current)?.offset ?? 0;
}

function span(className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function preloadLayers(frames) {
  // Warm the browser cache so a composite's first paint does not wait on a decode at the beat boundary.
  const files = new Set(Object.values(frames.frames ?? {}).flatMap((frame) => Object.values(frame.layers ?? {})));
  for (const file of files) {
    const image = new Image();
    image.decoding = "async";
    image.src = assetUrl(file);
  }
}

function ensureFrame(id, build) {
  if (frameId === id) return;
  frameId = id;
  dom.stage.replaceChildren(build());
}

function renderLanguages() {
  const available = availableLanguages(state.guide.index);
  dom.language.replaceChildren(...LANGUAGES.map((language) => {
    const option = document.createElement("option");
    option.value = language.code;
    option.disabled = !available.includes(language.code);
    option.textContent = option.disabled ? `${language.label} · ${labels()["ui.coming"]}` : language.label;
    option.selected = language.code === state.guide.language;
    return option;
  }));
}

function renderChapters() {
  dom.chapterList.replaceChildren(...state.guide.segments.segments.map((segment) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chapter";
    button.dataset.number = String(segment.number);
    const entry = entryFor(segment.number);
    button.append(
      span("chapter__number", String(segment.number)),
      span("chapter__title", labels()[segment.title_key] ?? ""),
      span("chapter__time", entry ? formatTime(entry.duration_seconds) : "")
    );
    item.append(button);
    return item;
  }));
  dom.chapterSelect.replaceChildren(...state.guide.segments.segments.map((segment) => {
    const option = document.createElement("option");
    option.value = String(segment.number);
    option.textContent = labels()[segment.title_key] ?? "";
    return option;
  }));
}

// Who reviewed what: the translation, the simulated Song review, and Song's own review line from the
// provider's link. Desktop shows it in the rail footer, phones at the end of the transcript.
function badgeList() {
  const list = document.createElement("ul");
  list.className = "badges";
  list.setAttribute("aria-label", labels()["ui.review_status"] ?? "");
  for (const badge of reviewBadges({ badges: state.guide.reviews?.badges, pack: state.guide.pack, clinicianDate: state.params.r, labels: labels() })) {
    const item = document.createElement("li");
    item.className = `badge badge--${badge.kind}`;
    item.append(span("badge__label", badge.label));
    if (badge.value) item.append(document.createTextNode(" "), span("badge__value", badge.value));
    list.append(item);
  }
  return list;
}

// The transcript ends with the review badges; on phones, which hide the rail footer, with the notice too.
function transcriptFooter() {
  const footer = document.createElement("div");
  footer.className = "transcript-footer";
  const notice = document.createElement("p");
  notice.className = "transcript-footer__notice";
  notice.textContent = labels()["ui.notice"];
  footer.append(notice, badgeList());
  return footer;
}

// A date from the provider's link, shown in the reading flow right after the sentence it belongs to.
function dataNote(frame) {
  const note = document.createElement("p");
  note.className = "transcript__data";
  note.textContent = (labels()[`ui.${frame.data_field.replace(/_date$/, "")}_on`] ?? "{date}").replace("{date}", state.followUp);
  return note;
}

function renderCallBlock() {
  const module = state.guide.canonical.modules.find((item) => item.id === "ci/when-to-call");
  const values = new Map((module?.structured_values ?? []).map((value) => [value.field, value.value]));
  const heading = document.createElement("p");
  heading.className = "call-block__heading";
  heading.textContent = labels()["ui.call_help"];
  const notice = document.createElement("p");
  notice.className = "call__notice";
  notice.textContent = labels()["ui.notice"];
  const link = (label, number) => {
    const anchor = document.createElement("a");
    anchor.className = "call";
    anchor.href = `tel:+1${String(number ?? "").replace(/\D/g, "")}`;
    anchor.append(span("call__label", label), span("call__number", String(number ?? "")));
    return anchor;
  };
  dom.callBlock.replaceChildren(
    heading,
    link(labels()["ui.nursing_line"], values.get("routine_nursing_line")),
    link(labels()["ui.emergency"], values.get("hospital_operator")),
    notice
  );
}

function renderTranscript() {
  const nodes = [];
  for (const segment of state.guide.segments.segments) {
    const heading = document.createElement("h3");
    heading.className = "transcript__chapter";
    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "transcript__chapter-button";
    jump.dataset.number = String(segment.number);
    jump.textContent = `${segment.number} · ${labels()[segment.title_key] ?? ""}`;
    heading.append(jump);
    nodes.push(heading);
    const list = state.sentences.get(segment.number) ?? [];
    list.forEach((sentence, position) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sentence";
      button.dataset.number = String(segment.number);
      button.dataset.sentence = sentence.id;
      button.dataset.start = String(sentence.start);
      sentence.words.forEach((word, index) => {
        button.append(span("sentence__word", word.text));
        if (index < sentence.words.length - 1 && (word.space ?? true)) button.append(document.createTextNode(" "));
      });
      nodes.push(button);
      const beat = segment.beats.find((item) => item.id === sentence.beat);
      const frame = beat ? state.guide.frames.frames[beat.frame] : null;
      if (frame?.data_field && state.followUp && list[position + 1]?.beat !== sentence.beat) nodes.push(dataNote(frame));
    });
  }
  nodes.push(transcriptFooter());
  dom.transcript.replaceChildren(...nodes);
}

function renderTicks() {
  dom.ticks.replaceChildren(...state.clock.segments.slice(1).map((segment) => {
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.left = `${(segment.offset / state.clock.total) * 100}%`;
    return tick;
  }));
}

function renderCue(cue, key) {
  cueKey = key;
  const words = cue ? state.cues.get(state.current)?.get(cue.id) ?? [] : [];
  dom.caption.replaceChildren();
  words.forEach((word, index) => {
    dom.caption.append(span("word", word.text));
    if (index < words.length - 1 && (word.space ?? true)) dom.caption.append(document.createTextNode(" "));
  });
}

function markChapter(number) {
  const total = state.guide.segments.segments.length;
  dom.chapterList.querySelectorAll(".chapter").forEach((button) => {
    if (Number(button.dataset.number) === number) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  dom.chapterSelect.value = String(number);
  dom.chapterCount.textContent = `${labels()["ui.chapter"]} ${number} ${labels()["ui.of"]} ${total}`;
  dom.chapterPrev.disabled = number <= 1;
  dom.chapterNext.disabled = number >= total;
  if (dom.follow.checked) {
    const heading = dom.transcript.querySelector(`.transcript__chapter-button[data-number="${number}"]`);
    if (heading) {
      const paneTop = dom.transcript.getBoundingClientRect().top;
      dom.transcript.scrollTop += heading.getBoundingClientRect().top - paneTop - 8;
    }
  }
}

function markSentence(number, sentence) {
  dom.transcript.querySelector(".sentence.is-current")?.classList.remove("is-current");
  if (!sentence) return;
  const button = dom.transcript.querySelector(`.sentence[data-number="${number}"][data-sentence="${sentence.id}"]`);
  if (!button) return;
  button.classList.add("is-current");
  if (dom.follow.checked) button.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
}

function sync(local) {
  const number = state.current;
  const timeline = state.timelines.get(number);
  const segment = segmentByNumber(number);
  if (!timeline || !segment) return;
  if (chapterNumber !== number) {
    chapterNumber = number;
    markChapter(number);
  }
  const beat = activeBeat(timeline, local);
  if (!beat) {
    ensureFrame(`title-${number}`, () => renderTitleCard(segment, state.guide.pack));
  } else {
    ensureFrame(`${number}:${beat.id}`, () => renderFrame({ ...state.guide.frames.frames[beat.frame], id: beat.frame }, {
      beat: segment.beats.find((item) => item.id === beat.id),
      beatWords: timeline.words.filter((word) => word.beat === beat.id),
      sentences: state.guide.sentences,
      pack: state.guide.pack,
      pending: (state.guide.instructions?.claims ?? []).filter((claim) => claim.frame === beat.frame && claim.status === "placeholder"),
      motion: state.guide.frames.motion ?? "static",
      data: { follow_up_date: state.followUp }
    }));
  }
  updateFrame(dom.stage.firstElementChild, local);
  const cue = activeCue(timeline, local);
  const nextCueKey = cue ? `${number}:${cue.id}` : null;
  if (nextCueKey !== cueKey) renderCue(cue, nextCueKey);
  if (cue) {
    const index = activeWordIndex(state.cues.get(number)?.get(cue.id) ?? [], local);
    dom.caption.querySelectorAll(".word").forEach((word, position) => word.classList.toggle("is-active", position === index));
  }
  const sentence = activeSentence(state.sentences.get(number), local);
  const nextSentenceKey = sentence ? `${number}:${sentence.id}` : null;
  if (nextSentenceKey !== sentenceKey) {
    sentenceKey = nextSentenceKey;
    markSentence(number, sentence);
  }
  if (sentence) {
    const index = activeWordIndex(sentence.words, local);
    dom.transcript.querySelectorAll(".sentence.is-current .sentence__word").forEach((word, position) => word.classList.toggle("is-active", position === index));
  }
  const global = currentOffset() + local;
  dom.scrubber.value = String(Math.round(global * 1000));
  dom.time.textContent = `${formatTime(global)} / ${formatTime(state.clock.total)}`;
}

function tick() {
  sync(dom.audio.currentTime);
  if (!dom.audio.paused && !dom.audio.ended) rafHandle = requestAnimationFrame(tick);
}

function updatePlayLabel() {
  const playing = !dom.audio.paused && !dom.audio.ended;
  const atEnd = dom.audio.ended && state.current === state.guide.segments.segments.length;
  dom.play.textContent = playing ? labels()["ui.pause"] : atEnd ? labels()["ui.replay"] : labels()["ui.play"];
  dom.play.setAttribute("aria-pressed", String(playing));
}

function setStatus(messages) {
  const text = messages.filter(Boolean).join(" ");
  dom.status.textContent = text;
  dom.status.hidden = !text;
}

function rememberSegment() {
  history.replaceState(null, "", `${location.pathname}${buildFragment({ ...state.params, s: state.current, l: state.guide.language })}`);
}

function waitForMetadata() {
  return new Promise((resolve) => {
    if (dom.audio.readyState >= 1) {
      resolve();
      return;
    }
    const done = () => {
      dom.audio.removeEventListener("loadedmetadata", done);
      dom.audio.removeEventListener("error", done);
      resolve();
    };
    dom.audio.addEventListener("loadedmetadata", done);
    dom.audio.addEventListener("error", done);
  });
}

async function loadSegment(number, { local = 0, play = false } = {}) {
  const entry = entryFor(number);
  if (!entry) return;
  state.current = number;
  frameId = null;
  cueKey = null;
  dom.audio.src = assetUrl(entry.audio);
  dom.audio.load();
  await waitForMetadata();
  if (state.current !== number) return;
  dom.audio.currentTime = local;
  sync(local);
  rememberSegment();
  if (play) await dom.audio.play().catch(showError);
  updatePlayLabel();
}

function isPlaying() {
  return !dom.audio.paused && !dom.audio.ended;
}

function seekGlobal(seconds, { play = isPlaying() } = {}) {
  const { number, local } = globalToLocal(state.clock, seconds);
  if (number !== state.current) {
    loadSegment(number, { local, play });
    return;
  }
  dom.audio.currentTime = local;
  sync(local);
  if (play && !isPlaying()) dom.audio.play().catch(showError);
}

function goToChapter(number, { play = isPlaying() } = {}) {
  if (!segmentByNumber(number)) return;
  seekGlobal(localToGlobal(state.clock, number, 0), { play });
}

function showError(error) {
  setStatus([error.message]);
}

async function init() {
  delete document.body.dataset.ready;
  cancelAnimationFrame(rafHandle);
  dom.audio.pause();
  const params = parseFragment(location.hash);
  const guide = await loadGuide(params.l);
  preloadLayers(guide.frames);
  const variant = variantFor(params, guide.presets);
  const conditions = conditionsFor(variant);
  const picks = guide.segments.segments.map((segment) => pickEntry(guide.index, segment.number, guide.language, variant));
  const entries = picks.map((pick) => pick.entry).filter(Boolean);
  const clock = buildGuideClock(entries);
  const timelines = new Map();
  const sentences = new Map();
  const cues = new Map();
  await Promise.all(entries.map(async (entry) => {
    const timeline = await fetchJson(entry.timeline);
    timelines.set(entry.number, timeline);
    sentences.set(entry.number, sentenceSpans(timeline));
    cues.set(entry.number, assignWordsToCues(timeline));
  }));
  const followUp = params.f ? formatFollowUp(params.f, guide.pack.language) : null;
  state = { guide, clock, timelines, sentences, cues, current: null, params, variant, conditions, followUp };
  frameId = null;
  cueKey = null;
  sentenceKey = null;
  chapterNumber = null;

  const text = guide.pack.labels;
  document.documentElement.lang = guide.pack.language;
  document.title = text["guide.title"];
  dom.title.textContent = text["guide.title"];
  dom.languageLabel.textContent = text["ui.language"];
  dom.print.textContent = text["ui.print_card"];
  dom.transportCard.textContent = text["ui.print_card"];
  dom.speedLabel.textContent = text["ui.speed"];
  dom.captionsLabel.textContent = text["ui.captions"];
  dom.transcriptHeading.textContent = text["ui.transcript"];
  dom.followLabel.textContent = text["ui.follow_along"];
  dom.chapterPrev.setAttribute("aria-label", text["ui.previous_chapter"]);
  dom.chapterNext.setAttribute("aria-label", text["ui.next_chapter"]);
  dom.scrubber.setAttribute("aria-label", text["ui.seek"]);
  dom.scrubber.max = String(Math.round(clock.total * 1000));
  dom.audio.playbackRate = Number(dom.speed.value);

  renderLanguages();
  renderChapters();
  renderCallBlock();
  renderTranscript();
  renderTicks();

  dom.captions.checked = readFlag(CAPTIONS_KEY);
  dom.captionBand.hidden = !dom.captions.checked;
  dom.follow.checked = readFlag(FOLLOW_KEY);

  const fallback = guide.packFallback || picks.some((pick) => pick.fallback);
  const pendingConditions = guide.segments.segments.flatMap((segment) => pendingConditionalBeats(segment, conditions)).map((beat) => beat.condition);
  setStatus(statusMessages({ pack: guide.pack, fallback, labels: text, pendingConditions }));

  const requested = Number.parseInt(params.s ?? "1", 10) || 1;
  await loadSegment(segmentByNumber(requested) && entryFor(requested) ? requested : entries[0]?.number ?? 1);

  window.__guide = {
    getState: () => ({
      segment: state.current,
      language: guide.language,
      total: clock.total,
      global: currentOffset() + dom.audio.currentTime,
      frame: frameId,
      cue: cueKey,
      sentence: sentenceKey,
      captions: !dom.captionBand.hidden,
      follow: dom.follow.checked,
      playing: isPlaying()
    })
  };
  // Scripts that capture the page wait for this: chapters draw early, labels and timing come last.
  document.body.dataset.ready = `${guide.language}:${state.current}`;
}

dom.play.addEventListener("click", () => {
  if (isPlaying()) {
    dom.audio.pause();
    return;
  }
  if (dom.audio.ended && state.current === state.guide.segments.segments.length) {
    goToChapter(1, { play: true });
    return;
  }
  dom.audio.play().catch(showError);
});
dom.audio.addEventListener("play", () => {
  updatePlayLabel();
  cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(tick);
});
dom.audio.addEventListener("pause", () => {
  updatePlayLabel();
  sync(dom.audio.currentTime);
});
dom.audio.addEventListener("ended", () => {
  const next = state.current + 1;
  if (segmentByNumber(next) && entryFor(next)) {
    loadSegment(next, { play: true });
    return;
  }
  updatePlayLabel();
  sync(dom.audio.currentTime);
});
dom.audio.addEventListener("seeked", () => sync(dom.audio.currentTime));
dom.scrubber.addEventListener("input", () => seekGlobal(Number(dom.scrubber.value) / 1000));
dom.speed.addEventListener("change", () => {
  dom.audio.playbackRate = Number(dom.speed.value);
});
dom.captions.addEventListener("change", () => {
  dom.captionBand.hidden = !dom.captions.checked;
  writeFlag(CAPTIONS_KEY, dom.captions.checked);
});
dom.follow.addEventListener("change", () => writeFlag(FOLLOW_KEY, dom.follow.checked));
dom.language.addEventListener("change", () => {
  location.hash = buildFragment({ ...state.params, s: state.current, l: normalizeLanguage(dom.language.value) });
});
dom.chapterList.addEventListener("click", (event) => {
  const button = event.target.closest(".chapter");
  if (button) goToChapter(Number(button.dataset.number));
});
dom.chapterSelect.addEventListener("change", () => goToChapter(Number(dom.chapterSelect.value)));
dom.chapterPrev.addEventListener("click", () => goToChapter(state.current - 1));
dom.chapterNext.addEventListener("click", () => goToChapter(state.current + 1));
dom.transcript.addEventListener("click", (event) => {
  const chapter = event.target.closest(".transcript__chapter-button");
  if (chapter) {
    goToChapter(Number(chapter.dataset.number), { play: true });
    return;
  }
  const sentence = event.target.closest(".sentence");
  if (sentence) seekGlobal(localToGlobal(state.clock, Number(sentence.dataset.number), Number(sentence.dataset.start)), { play: true });
});
document.addEventListener("keydown", (event) => {
  if (!state || event.target.matches("input, select, textarea, button, summary, a")) return;
  const isSpace = event.key === " " || event.key === "Spacebar" || event.code === "Space";
  if (isSpace) {
    event.preventDefault();
    dom.play.click();
  } else if (event.key === "ArrowRight") {
    seekGlobal(currentOffset() + dom.audio.currentTime + SEEK_STEP_SECONDS);
  } else if (event.key === "ArrowLeft") {
    seekGlobal(currentOffset() + dom.audio.currentTime - SEEK_STEP_SECONDS);
  }
});
window.addEventListener("hashchange", () => init().catch(showError));
init().catch(showError);
