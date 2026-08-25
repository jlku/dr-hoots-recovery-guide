import { loadProgrammingPrototype, loadSafetyCardModel } from "./safety-card.js?v=8";
import { buildActivationComparisonModel } from "../scripts/lib/activation-production.mjs";

const params = new URLSearchParams(window.location.search);
const requestedMode = params.get("mode");
const mode = requestedMode === "scroll" ? "scroll" : "watch";
const embedded = params.get("embed") === "1";
const comparisonVariant = params.get("comparison") === "baseline" ? "baseline" : "mixed";
const requestedMediaState = params.get("media");
const generatedMediaState = ["available", "blocked", "stale"].includes(requestedMediaState)
  ? requestedMediaState
  : "animatic";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = document.querySelector("#variation-root");
const title = document.querySelector("#mode-title");
const modeNames = { watch: "Mascot-guided video", scroll: "Read step by step" };

if (["linear", "chaptered"].includes(requestedMode)) {
  params.set("mode", "watch");
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

document.body.dataset.mode = mode;
document.body.dataset.embed = String(embedded);
document.body.dataset.comparisonVariant = comparisonVariant;
document.body.dataset.generatedMediaState = generatedMediaState;
document.title = mode === "scroll" ? `${modeNames[mode]} — Recovery guide` : `${modeNames[mode]} — Dr. Hoots`;
title.textContent = modeNames[mode];
document.querySelector(`[data-mode-link="${mode}"]`)?.setAttribute("aria-current", "page");
const brandDetail = document.querySelector(".prototype-brand span");
if (brandDetail) brandDetail.textContent = mode === "watch" ? "Mascot-guided safety guide" : "Reader-paced preview";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className = "control") {
  const node = element("button", className, label);
  node.type = "button";
  return node;
}

function blocksFor(scene) {
  return scene.display?.blocks ?? scene.sentences;
}

function spokenText(scene) {
  return blocksFor(scene).map((block) => block.text).join(" ");
}

function narrationDurationMs(scene) {
  const words = spokenText(scene).trim().split(/\s+/).filter(Boolean).length;
  return Math.max((scene.target_seconds ?? 5) * 1000, words * 430 + 800);
}

async function loadNarrationManifest() {
  const response = await fetch(new URL("./audio/manifest.json?v=1", import.meta.url));
  if (!response.ok) throw new Error("The narration manifest could not be loaded.");
  const manifest = await response.json();
  return new Map(manifest.records.map((record) => [record.id, record]));
}

function narrationId(scene, format) {
  if (scene.id === "scene/activation/healing") return "healing";
  if (scene.id === "scene/activation/programming") return format === "watch" ? "chaptered-programming" : `${format}-programming`;
  if (scene.id === "scene/activation/follow-up") return "follow-up";
  return null;
}

function createSpeakerAvatar(comparisonScene) {
  const avatar = element("div", "speaker-avatar comparison-avatar");
  avatar.setAttribute("aria-hidden", "true");
  avatar.dataset.focalAnchor = "0.5,0.42";
  avatar.dataset.preservesHeadAndBeak = "true";
  const image = document.createElement("img");
  image.className = "speaker-avatar__image comparison-avatar__image";
  image.src = new URL("./character/dr-hoots-motion-base-v2.png", import.meta.url).href;
  image.alt = "";
  image.width = 1254;
  image.height = 1254;
  avatar.append(image);
  if (comparisonScene.motion.mode !== "static") {
    avatar.append(element("span", "comparison-avatar__beak"));
  }
  return avatar;
}

function createComparisonHost(comparisonScene) {
  const host = element("div", "comparison-host");
  host.setAttribute("aria-hidden", "true");
  host.dataset.motionEnvelope = comparisonScene.motion.envelope;
  const puppet = element("div", "comparison-host__puppet");
  const base = document.createElement("img");
  base.className = "comparison-host__base";
  base.src = new URL("./character/dr-hoots-motion-base-v2.png", import.meta.url).href;
  base.alt = "";
  base.width = 1254;
  base.height = 1254;
  puppet.append(base);
  if (comparisonScene.motion.mode !== "static") {
    const wing = document.createElement("img");
    wing.className = "comparison-host__wing";
    wing.src = new URL("./character/dr-hoots-wing-rig-v2.png", import.meta.url).href;
    wing.alt = "";
    wing.width = 1024;
    wing.height = 1024;
    puppet.append(wing, element("span", "comparison-host__beak"));
  }
  host.append(puppet);
  return host;
}

function createWatchVisual(scene, index, total, comparisonScene) {
  const treatment = comparisonScene.render_treatment;
  const visual = element("div", `watch-visual watch-visual--${treatment.replace("_", "-")}`);
  if (treatment === "diagram_led") {
    const image = document.createElement("img");
    image.className = "watch-visual__illustration";
    image.src = scene.illustration.file;
    image.alt = scene.illustration.alt;
    image.width = scene.illustration.width;
    image.height = scene.illustration.height;
    visual.append(image);
  } else if (treatment === "host_led") {
    visual.append(createComparisonHost(comparisonScene));
    const context = element("div", "watch-visual__host-context");
    context.append(
      element("p", "watch-visual__step", `Step ${index + 1} of ${total}`),
      element("h2", "watch-visual__host-title", scene.label)
    );
    visual.append(context);
  } else {
    visual.append(
      element("p", "watch-visual__step", `Step ${index + 1} of ${total}`),
      element("h2", "watch-visual__title", scene.label)
    );
  }
  return visual;
}

function createSpeakerCaption(scene, comparisonScene) {
  const text = spokenText(scene);
  const caption = element("div", "video-caption");
  caption.classList.toggle("video-caption--without-avatar", comparisonScene.caption.avatar.count === 0);
  caption.dataset.sentenceIds = blocksFor(scene).flatMap((block) => block.canonical_sentence_ids ?? []).join(" ");
  caption.dataset.spokenText = text;
  const speech = element("p", "video-caption__speech");
  speech.append(element("span", "video-caption__speaker", "Dr. Hoots"));
  const copy = element("span", "video-caption__copy");
  let cursor = 0;
  for (const match of text.matchAll(/\S+/g)) {
    if (match.index > cursor) copy.append(document.createTextNode(text.slice(cursor, match.index)));
    const word = element("span", "caption-word", match[0]);
    word.dataset.charStart = String(match.index);
    word.dataset.charEnd = String(match.index + match[0].length);
    copy.append(word);
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) copy.append(document.createTextNode(text.slice(cursor)));
  speech.append(copy);
  if (comparisonScene.caption.avatar.count === 1) {
    caption.append(createSpeakerAvatar(comparisonScene));
  }
  caption.append(speech);
  return caption;
}

function flattenedTimestamps(record) {
  return record.timestamps.flatMap((chunk) => chunk.characters.map((character, index) => ({
    character,
    start: chunk.character_start_times_seconds[index],
    end: chunk.character_end_times_seconds[index]
  })));
}

function attachNarration(panel, record) {
  if (!record) throw new Error(`Narration is missing for ${panel.dataset.sceneId}.`);
  const caption = panel.querySelector(".video-caption");
  const characters = flattenedTimestamps(record);
  const timestampedText = characters.map(({ character }) => character).join("");
  if (record.text !== caption.dataset.spokenText || timestampedText !== record.text) {
    throw new Error(`Narration copy is out of sync for ${panel.dataset.sceneId}.`);
  }

  for (const word of caption.querySelectorAll(".caption-word")) {
    const startIndex = Number(word.dataset.charStart);
    const endIndex = Number(word.dataset.charEnd) - 1;
    word.dataset.timeStart = String(characters[startIndex].start);
    word.dataset.timeEnd = String(characters[endIndex].end);
  }

  const lastTimestamp = characters.reduce((latest, character) => {
    return Number.isFinite(character.end) ? Math.max(latest, character.end) : latest;
  }, 0);
  panel.dataset.narrationDurationMs = String(Math.ceil((lastTimestamp + .55) * 1000));
  const audio = document.createElement("audio");
  audio.className = "narration-audio";
  audio.src = new URL(`./audio/${record.file.split("/").pop()}`, import.meta.url).href;
  audio.preload = "auto";
  audio.hidden = true;
  audio.setAttribute("aria-hidden", "true");
  panel.append(audio);
}

function createWatchPanel(scene, index, total, narrationRecord, comparisonScene) {
  const panel = element("article", "watch-panel");
  panel.dataset.sceneId = scene.id;
  panel.setAttribute("data-render-treatment", comparisonScene.render_treatment);
  panel.setAttribute("data-stage-host-count", String(comparisonScene.stage.host_count));
  panel.setAttribute("data-caption-avatar-count", String(comparisonScene.caption.avatar.count));
  panel.setAttribute("data-generated-media-state", generatedMediaState);
  panel.setAttribute("data-motion-mode", comparisonScene.motion.mode);
  panel.append(createWatchVisual(scene, index, total, comparisonScene));
  panel.append(createSpeakerCaption(scene, comparisonScene));
  attachNarration(panel, narrationRecord);
  return panel;
}

const narrationStates = new WeakMap();

function highlightCaptionWord(panel, index) {
  const words = [...panel.querySelectorAll(".caption-word")];
  words.forEach((word, wordIndex) => word.classList.toggle("is-active", wordIndex === index));
}

function wordIndexForTime(panel, timeSeconds) {
  const words = [...panel.querySelectorAll(".caption-word")];
  let activeIndex = 0;
  words.forEach((word, index) => {
    if (Number(word.dataset.timeStart) <= timeSeconds) activeIndex = index;
  });
  return activeIndex;
}

function startNarration(panel, durationMs, resuming = false) {
  let state = narrationStates.get(panel);
  if (!resuming || !state) {
    state = { elapsedMs: 0, durationMs, frame: 0 };
    narrationStates.set(panel, state);
    highlightCaptionWord(panel, 0);
  }
  state.startedAt = performance.now();
  const audio = panel.querySelector(".narration-audio");
  if (!resuming) audio.currentTime = 0;
  audio.play().catch(() => {});

  const tick = (now) => {
    if (!audio.paused && Number.isFinite(audio.currentTime)) {
      highlightCaptionWord(panel, wordIndexForTime(panel, audio.currentTime));
    } else {
      const wordCount = panel.querySelectorAll(".caption-word").length;
      const progress = Math.min(0.999, (state.elapsedMs + now - state.startedAt) / state.durationMs);
      highlightCaptionWord(panel, Math.floor(progress * wordCount));
    }
    state.frame = requestAnimationFrame(tick);
  };
  state.frame = requestAnimationFrame(tick);
}

window.addEventListener("pagehide", () => {
  document.querySelectorAll(".narration-audio").forEach((audio) => audio.pause());
});

function pauseNarration(panel) {
  const state = narrationStates.get(panel);
  if (!state) return;
  state.elapsedMs += performance.now() - state.startedAt;
  cancelAnimationFrame(state.frame);
  panel.querySelector(".narration-audio")?.pause();
}

function stopNarration(panel) {
  const state = narrationStates.get(panel);
  if (state) cancelAnimationFrame(state.frame);
  narrationStates.delete(panel);
  highlightCaptionWord(panel, -1);
  const audio = panel.querySelector(".narration-audio");
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}

function panelDurationMs(panel, scene) {
  return Number(panel.dataset.narrationDurationMs) || narrationDurationMs(scene);
}

function animateHost(panel) {
  panel.classList.remove("is-playing");
  void panel.offsetWidth;
  panel.classList.add("is-playing");
  const video = panel.querySelector("video");
  if (video && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.currentTime = 0;
    video.play().catch(() => {});
  }
}

function pauseHost(panel) {
  panel.classList.remove("is-playing");
  const video = panel.querySelector("video");
  if (video) video.pause();
}

function resumeHost(panel) {
  panel.classList.add("is-playing");
  const video = panel.querySelector("video");
  if (video && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.play().catch(() => {});
  }
}

function startPanel(panel, scene, durationMs, resuming = false) {
  if (resuming) resumeHost(panel);
  else animateHost(panel);
  startNarration(panel, durationMs, resuming);
}

function pausePanel(panel) {
  pauseHost(panel);
  pauseNarration(panel);
}

function stopPanel(panel) {
  pauseHost(panel);
  stopNarration(panel);
}

function formatTime(milliseconds, round = Math.floor) {
  const seconds = Math.max(0, round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderSafetyWatch() {
  const shell = element("section", "watch-experience watch-experience--safety");
  shell.setAttribute("aria-label", "Mascot-guided cochlear implant recovery guide");
  shell.setAttribute("data-patient-ready", "false");
  shell.setAttribute("data-clinical-review", "bypassed-private-export");

  const notice = element(
    "p",
    "comparison-status",
    "Private review build · clinical review bypassed · not for patient use"
  );
  const frame = document.createElement("iframe");
  frame.className = "safety-watch-frame";
  frame.title = "Mascot-guided cochlear implant recovery safety guide";
  frame.src = new URL("../preview/guide-video.html?embed=1&v=12", import.meta.url).href;
  frame.loading = "eager";

  frame.addEventListener("load", () => {
    try {
      const doc = frame.contentDocument;
      const playButton = doc.querySelector("#watch-play");
      if (!playButton) throw new Error("The guide player did not initialize.");
      shell.dataset.playerReady = "true";
      const runtime = doc.querySelector("#total-label")?.textContent?.trim();
      notice.textContent = `Private review build · clinical review bypassed · not for patient use${runtime ? ` · ${runtime}` : ""}`;
    } catch (error) {
      notice.textContent = `The safety guide could not be loaded: ${error.message}`;
    }
  }, { once: true });

  shell.append(notice, frame);
  root.replaceChildren(shell);
}

function renderWatch(scenes, narration, comparisonModel) {
  const shell = element("section", "watch-experience");
  shell.setAttribute("aria-label", "Mascot-guided recovery video");
  shell.setAttribute("data-comparison-variant", comparisonModel.variant);
  shell.setAttribute("data-generated-media-state", comparisonModel.generated_media_state);
  shell.setAttribute("data-patient-ready", "false");
  const panels = scenes.map((scene, index) => createWatchPanel(
    scene,
    index,
    scenes.length,
    narration.get(narrationId(scene, "watch")),
    comparisonModel.scenes[index]
  ));
  const durations = panels.map((panel, index) => panelDurationMs(panel, scenes[index]));
  const starts = durations.map((_, index) => durations.slice(0, index).reduce((total, duration) => total + duration, 0));
  const totalDuration = durations.reduce((total, duration) => total + duration, 0);

  const layout = element("div", "watch-layout");
  const navigation = element("nav", "chapter-nav");
  navigation.setAttribute("aria-label", "What to expect");
  navigation.append(element("h2", "chapter-nav__title", "What to expect"));
  const chapterList = element("div", "chapter-nav__list");

  const player = element("div", "watch-player");
  const stage = element("div", "watch-stage");
  stage.setAttribute("aria-live", "polite");
  stage.append(...panels);

  const controls = element("div", "watch-controls");
  const play = button("Play", "control control--primary watch-play");
  play.setAttribute("aria-label", "Play video");
  const time = element("output", "watch-time", `0:00 / ${formatTime(totalDuration, Math.ceil)}`);
  time.setAttribute("aria-live", "off");
  const scrubber = document.createElement("input");
  scrubber.className = "watch-scrubber";
  scrubber.type = "range";
  scrubber.min = "0";
  scrubber.max = String(totalDuration);
  scrubber.step = "100";
  scrubber.value = "0";
  scrubber.setAttribute("aria-label", "Video position");
  const speedControl = element("label", "playback-speed");
  speedControl.append(element("span", "playback-speed__label", "Speed"));
  const speedSelect = document.createElement("select");
  speedSelect.className = "playback-speed__select";
  speedSelect.setAttribute("aria-label", "Playback speed");
  for (const rate of [.75, 1, 1.25, 1.5, 2]) {
    const option = document.createElement("option");
    option.value = String(rate);
    option.textContent = `${rate}×`;
    if (rate === 1) option.selected = true;
    speedSelect.append(option);
  }
  speedControl.append(speedSelect);
  controls.append(play, time, scrubber, speedControl);
  player.append(stage, controls);
  layout.append(navigation, player);
  const notice = element(
    "p",
    "comparison-status",
    "Private prototype · unverified draft · not for patient use"
  );
  if (["blocked", "stale"].includes(comparisonModel.generated_media_state)) {
    notice.append(document.createTextNode(" · neutral static fallback"));
  } else {
    notice.append(document.createTextNode(" · low-fidelity animatic motion"));
  }
  shell.append(notice, layout);
  root.replaceChildren(shell);

  let current = 0;
  let playing = false;
  let finished = false;
  let playbackRate = 1;
  let remainingMs = durations[0];
  let deadline = 0;
  let timer;
  let progressFrame;
  let completed = new Set();

  const chapterButtons = scenes.map((scene, index) => {
    const chapter = button("", "chapter-button");
    chapter.dataset.chapterIndex = String(index);
    const status = element("span", "chapter-button__status", String(index + 1));
    const copy = element("span", "chapter-button__copy");
    copy.append(element("span", "chapter-button__label", scene.label));
    copy.append(element("span", "chapter-button__duration", formatTime(durations[index], Math.ceil)));
    chapter.append(status, copy);
    return chapter;
  });
  chapterList.append(...chapterButtons);
  navigation.append(chapterList);

  function applyPlaybackRate() {
    panels.forEach((panel) => {
      const audio = panel.querySelector(".narration-audio");
      const video = panel.querySelector("video");
      if (audio) audio.playbackRate = playbackRate;
      if (video) video.playbackRate = playbackRate;
    });
  }

  function elapsedInCurrent() {
    if (finished) return durations[current];
    if (playing) return durations[current] - Math.max(0, deadline - performance.now()) * playbackRate;
    return durations[current] - remainingMs;
  }

  function showProgress(currentElapsed = elapsedInCurrent()) {
    const elapsed = Math.min(totalDuration, starts[current] + Math.max(0, Math.min(durations[current], currentElapsed)));
    scrubber.value = String(Math.round(elapsed));
    time.value = `${formatTime(elapsed)} / ${formatTime(totalDuration, Math.ceil)}`;
  }

  function updatePanels() {
    panels.forEach((panel, index) => { panel.hidden = index !== current; });
  }

  function updateRail() {
    chapterButtons.forEach((chapter, index) => {
      const isCurrent = index === current;
      const isComplete = completed.has(index);
      chapter.classList.toggle("is-complete", isComplete);
      chapter.querySelector(".chapter-button__status").textContent = isComplete ? "✓" : String(index + 1);
      chapter.setAttribute("aria-label", `${scenes[index].label}, ${formatTime(durations[index], Math.ceil)}${isComplete ? ", completed" : ""}`);
      if (isCurrent) chapter.setAttribute("aria-current", "step");
      else chapter.removeAttribute("aria-current");
    });
  }

  function setPlayState(label, ariaLabel) {
    play.textContent = label;
    play.setAttribute("aria-label", ariaLabel);
  }

  function cancelPlayback() {
    window.clearTimeout(timer);
    window.cancelAnimationFrame(progressFrame);
  }

  function animateProgress() {
    window.cancelAnimationFrame(progressFrame);
    const tick = () => {
      showProgress();
      if (playing) progressFrame = window.requestAnimationFrame(tick);
    };
    progressFrame = window.requestAnimationFrame(tick);
  }

  function pause() {
    remainingMs = Math.max(0, deadline - performance.now()) * playbackRate;
    playing = false;
    cancelPlayback();
    pausePanel(panels[current]);
    showProgress();
    setPlayState("Play", "Resume video");
  }

  function schedule() {
    cancelPlayback();
    const wallRemainingMs = remainingMs / playbackRate;
    deadline = performance.now() + wallRemainingMs;
    animateProgress();
    timer = window.setTimeout(() => {
      stopPanel(panels[current]);
      completed.add(current);
      updateRail();
      if (current === panels.length - 1) {
        remainingMs = 0;
        playing = false;
        finished = true;
        showProgress(durations[current]);
        setPlayState("Replay", "Replay video");
        return;
      }
      current += 1;
      remainingMs = durations[current];
      updatePanels();
      updateRail();
      showProgress(0);
      startPanel(panels[current], scenes[current], remainingMs / playbackRate);
      applyPlaybackRate();
      schedule();
    }, wallRemainingMs);
  }

  function start() {
    if (finished) {
      panels.forEach((panel) => stopPanel(panel));
      completed = new Set();
      current = 0;
      remainingMs = durations[0];
      finished = false;
      updatePanels();
      updateRail();
      showProgress(0);
    }
    playing = true;
    setPlayState("Pause", "Pause video");
    const resuming = remainingMs < durations[current];
    startPanel(panels[current], scenes[current], remainingMs / playbackRate, resuming);
    applyPlaybackRate();
    schedule();
  }

  function selectChapter(index, fromRail = false) {
    if (fromRail) {
      shell.dataset.chapterRailTouched = "true";
      shell.dispatchEvent(new CustomEvent("guide:chapter-navigation", { bubbles: true, detail: { index, sceneId: scenes[index].id } }));
    }
    if (index === current) return;
    const wasPlaying = playing;
    if (playing) remainingMs = Math.max(0, deadline - performance.now()) * playbackRate;
    cancelPlayback();
    stopPanel(panels[current]);
    playing = false;
    finished = false;
    current = index;
    remainingMs = durations[current];
    updatePanels();
    updateRail();
    showProgress(0);
    if (wasPlaying) start();
    else setPlayState("Play", "Play video");
  }

  function seekTo(totalElapsed) {
    const targetElapsed = Math.max(0, Math.min(totalDuration, totalElapsed));
    const wasPlaying = playing;
    cancelPlayback();
    stopPanel(panels[current]);
    playing = false;
    completed = new Set(durations.map((duration, index) => starts[index] + duration <= targetElapsed + 50 ? index : -1).filter((index) => index >= 0));
    const targetIndex = durations.findIndex((duration, index) => targetElapsed < starts[index] + duration);
    current = targetIndex < 0 ? durations.length - 1 : targetIndex;
    const offset = Math.min(durations[current], Math.max(0, targetElapsed - starts[current]));
    remainingMs = Math.max(0, durations[current] - offset);
    finished = targetElapsed >= totalDuration - 50;
    updatePanels();
    updateRail();
    stopPanel(panels[current]);
    const audio = panels[current].querySelector(".narration-audio");
    const video = panels[current].querySelector("video");
    try { audio.currentTime = offset / 1000; } catch {}
    if (video && Number.isFinite(video.duration) && video.duration > 0) video.currentTime = (offset / 1000) % video.duration;
    showProgress(offset);
    if (finished) {
      setPlayState("Replay", "Replay video");
      return;
    }
    if (wasPlaying) {
      playing = true;
      setPlayState("Pause", "Pause video");
      startPanel(panels[current], scenes[current], remainingMs / playbackRate, true);
      applyPlaybackRate();
      schedule();
    } else {
      setPlayState("Play", offset > 0 ? "Resume video" : "Play video");
    }
  }

  play.addEventListener("click", () => playing ? pause() : start());
  chapterList.addEventListener("click", (event) => {
    const chapter = event.target.closest(".chapter-button");
    if (!chapter) return;
    selectChapter(Number(chapter.dataset.chapterIndex), true);
  });
  scrubber.addEventListener("input", () => seekTo(Number(scrubber.value)));
  speedSelect.addEventListener("change", () => {
    const nextRate = Number(speedSelect.value);
    if (!Number.isFinite(nextRate) || nextRate <= 0) return;
    if (playing) remainingMs = Math.max(0, deadline - performance.now()) * playbackRate;
    playbackRate = nextRate;
    applyPlaybackRate();
    if (playing) schedule();
  });

  panels.forEach((panel, index) => { panel.hidden = index !== 0; });
  updateRail();
  showProgress(0);
}

function createStoryCue(scene, index, total) {
  const cue = element("div", "story-cue");
  cue.setAttribute("aria-hidden", "true");
  const rail = element("div", "story-cue__rail");
  for (let step = 0; step < total; step += 1) {
    const marker = element("span", "story-cue__marker");
    if (step === index) marker.classList.add("is-current");
    rail.append(marker);
  }
  cue.append(
    element("p", "story-cue__step", `Step ${index + 1} of ${total}`),
    rail,
    element("p", "story-cue__label", scene.label)
  );
  return cue;
}

function createStoryVisual(scene, index, total, mobile = false) {
  const wrapper = element("div", `story-visual${mobile ? " story-visual--mobile" : ""}`);
  wrapper.dataset.sceneId = scene.id;
  const art = element("div", `story-art${scene.illustration ? " story-art--illustration-only" : " story-art--sequence"}`);
  if (scene.illustration) {
    const image = document.createElement("img");
    image.className = "story-art__illustration";
    image.src = scene.illustration.file;
    image.alt = scene.illustration.alt;
    image.width = scene.illustration.width;
    image.height = scene.illustration.height;
    art.append(image);
  } else {
    art.append(createStoryCue(scene, index, total));
  }
  wrapper.append(art);
  return wrapper;
}

function renderScroll(scenes) {
  const shell = element("section", "story-experience");
  shell.setAttribute("aria-label", "Reader-paced programming-visit guide");
  const stepTrack = element("div", "story-steps");
  const stickyStage = element("div", "story-stage");
  stickyStage.setAttribute("aria-hidden", "true");
  const stickyVisuals = scenes.map((scene, index) => createStoryVisual(scene, index, scenes.length));
  stickyStage.append(...stickyVisuals);

  const steps = scenes.map((scene, index) => {
    const step = element("article", `story-step${scene.illustration ? "" : " story-step--sequence"}`);
    step.dataset.sceneId = scene.id;
    step.append(createStoryVisual(scene, index, scenes.length, true));
    step.append(element("h2", "story-step__title", scene.label));
    const body = element("div", "story-step__copy");
    for (const block of blocksFor(scene)) {
      const paragraph = element("p", "story-step__sentence", block.text);
      paragraph.dataset.sentenceIds = (block.canonical_sentence_ids ?? [block.id]).join(" ");
      body.append(paragraph);
    }
    step.append(body);
    if (index === 0) step.setAttribute("aria-current", "step");
    return step;
  });
  stepTrack.append(...steps);
  shell.append(stepTrack, stickyStage);
  root.replaceChildren(shell);

  function setActive(index) {
    steps.forEach((step, stepIndex) => {
      step.classList.toggle("is-active", stepIndex === index);
      if (stepIndex === index) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    stickyVisuals.forEach((visual, visualIndex) => visual.classList.toggle("is-active", visualIndex === index));
  }

  setActive(0);
  if ("IntersectionObserver" in window) {
    const ratios = new Map();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) ratios.set(entry.target, entry.intersectionRatio);
      let activeIndex = 0;
      let activeRatio = -1;
      steps.forEach((step, index) => {
        const ratio = ratios.get(step) ?? 0;
        if (ratio > activeRatio) { activeIndex = index; activeRatio = ratio; }
      });
      setActive(activeIndex);
    }, { threshold: [0, .25, .5, .75], rootMargin: "-18% 0px -35% 0px" });
    steps.forEach((step) => observer.observe(step));
  }
}

if (mode === "watch") {
  renderSafetyWatch();
} else {
  try {
    const [model, prototype, narration, productionResponse] = await Promise.all([
      loadSafetyCardModel(),
      loadProgrammingPrototype(),
      loadNarrationManifest(),
      fetch(new URL("../content/productions/ci-activation-v0.1.0.json?v=1", import.meta.url))
    ]);
    if (!productionResponse.ok) throw new Error("The private activation production contract could not be loaded.");
    const production = await productionResponse.json();
    const formatKey = { scroll: "scroll_guide" }[mode];
    const activationScenes = model.scenes
      .filter((scene) => scene.module_id === "ci/activation")
      .map((scene) => scene.id === prototype.adaptation.scene_id
        ? {
            ...scene,
            display: prototype.adaptation.formats[formatKey],
            illustration: {
              ...prototype.illustration,
              file: new URL(`./illustrations/${prototype.illustration.file}`, import.meta.url).href
            }
          }
        : scene);

    buildActivationComparisonModel({
      production,
      variant: comparisonVariant,
      media_state: generatedMediaState,
      reduced_motion: reducedMotion,
      scenes: activationScenes.map((scene) => {
        const narrationRecord = narration.get(narrationId(scene, "watch"));
        const timestampEnds = narrationRecord.timestamps.flatMap(
          (chunk) => chunk.character_end_times_seconds
        );
        return {
          scene_id: scene.id,
          label: scene.label,
          text: spokenText(scene),
          timing: {
            narration_id: narrationRecord.id,
            duration_seconds: Math.max(...timestampEnds)
          },
          illustration: scene.illustration
            ? { file: scene.illustration.file, alt: scene.illustration.alt }
            : null
        };
      })
    });

    renderScroll(activationScenes);
  } catch (error) {
    root.replaceChildren(element("p", "loading-state", error.message));
  }
}
