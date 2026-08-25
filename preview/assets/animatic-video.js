// Guided-video presentation: one deterministic timeline over the fourteen
// frames plus welcome, in the approved watch shell. Every scene is narrated
// and slaves the clock to its audio. Dr. Hoots follows
// the standing rules: one visible Hoots at a time. Host scenes give him the
// stage; ordinary instruction scenes keep him in a compact Loom-style speaker
// bubble; two decision scenes expand that bubble into a coach intervention.
import { frameById } from "./frames.js";
import { GUIDE_DATA } from "./guide-data.js";

const PAD = 0.9;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EMBEDDED = new URLSearchParams(window.location.search).get("embed") === "1";
document.documentElement.dataset.embed = String(EMBEDDED);

// Canon clips: generated from the two-winged base cropped out of the approved
// turnaround; lower text band removed deterministically (see draft-manifest).
const HOST_MEDIA = {
  intro: { clip: "assets/media/host-welcome-canon.mp4", poster: "assets/media/host-welcome-canon-poster.png" },
  "s-healing": { clip: "assets/media/host-healing-canon.mp4", poster: "assets/media/host-healing-canon-poster.png" },
  "s-followup": { clip: "assets/media/host-follow-up-canon.mp4", poster: "assets/media/host-follow-up-canon-poster.png" }
};

const COACH_MEDIA = {
  poster: "assets/media/host-welcome-canon-poster.png",
  avatar: "assets/media/dr-hoots-speaker-avatar.png",
  scenes: {
    "s-day2": { clip: "assets/media/coach-wound-paths.mp4", poster: "assets/media/coach-wound-paths-poster.png" },
    "s-paths": { clip: "assets/media/coach-wound-paths.mp4", poster: "assets/media/coach-wound-paths-poster.png" },
    "s-numbers": { clip: "assets/media/coach-call-numbers.mp4", poster: "assets/media/coach-call-numbers-poster.png" }
  }
};

// Consolidated cut: chapter grouping lives in navigation rather than silent
// interstitial slides, so every page begins with narration.
// Host grammar: intro + healing + follow-up own the stage; every other scene
// retains a circular speaker presence, with the two decision scenes receiving
// a larger narration-bound coach intervention.
const SCENES = [
  { id: "intro", kind: "host", mode: "host", track: "welcome-ci", num: "—", label: "Welcome" },
  { id: "s-day2", kind: "frame", mode: "focus", frame: frameById("wound-dressing"), track: "wound-day2", num: "01", label: "Day 2: bandage off, check for tape" },
  { id: "s-paths", kind: "frame", mode: "decision", intervention: true, frame: frameById("wound-paths-combo"), track: "wound-paths", num: "02–03", label: "The two paths" },
  { id: "s-milestones", kind: "frame", mode: "focus", frame: frameById("wound-milestones"), track: "wound-milestones", num: "04–05", label: "The next milestones" },
  { id: "s-redness", kind: "frame", mode: "focus", frame: frameById("call-redness"), track: "call-three-signs", num: "06", label: "Redness: all three signs" },
  { id: "s-any", kind: "frame", mode: "focus", frame: frameById("call-any-list"), track: "call-any", num: "07–10", label: "Also call for any of these" },
  { id: "s-numbers", kind: "frame", mode: "decision", intervention: true, frame: frameById("call-contact"), track: "call-numbers", num: "11", label: "The numbers to use" },
  { id: "s-healing", kind: "host", mode: "host", frame: frameById("act-healing"), track: "healing", num: "12", label: "After healing" },
  { id: "s-programming", kind: "frame", mode: "focus", frame: frameById("act-programming"), track: "chaptered-programming", num: "13", label: "Your first programming visit" },
  { id: "s-followup", kind: "host", mode: "host", frame: frameById("act-follow-up"), track: "follow-up", num: "14", label: "Visits that continue" }
];
if (SCENES.some((scene) => !scene.track)) throw new Error("Every Watch scene must have narration.");

const trackOf = (scene) => (scene.track ? GUIDE_DATA.tracks[scene.track] : null);
for (const scene of SCENES) {
  const track = trackOf(scene);
  scene.dur = track ? (track.duration ?? 4) + PAD : scene.silent;
}
let offset = 0;
for (const scene of SCENES) {
  scene.start = offset;
  offset += scene.dur;
}
const TOTAL = offset;

const presentationMarkup = {
  intro: `
    <div class="pres-copy pres-copy--welcome">
      <p class="pres-eyebrow pres-eyebrow--inverse">Recovery guide</p>
      <h2>Your cochlear implant recovery</h2>
      <p class="pres-dek">What to do in the first two weeks</p>
    </div>`,
  "s-day2": `
    <div class="pres-copy pres-copy--action">
      <p class="pres-eyebrow">Day 2</p>
      <h2>Remove the head bandage.</h2>
      <span class="pres-rule" aria-hidden="true"></span>
      <p class="pres-dek">Then check behind the ear for tape over the incision.</p>
    </div>
    <figure class="pres-figure"><img src="assets/cards/art/frame-01-art-grounded-v2.png" alt="Head bandage being removed, followed by a check behind the ear for tape"></figure>`,
  "s-paths": `
    <header class="pres-heading"><p class="pres-eyebrow">Choose the matching path</p><h2>Is there tape over the incision?</h2></header>
    <div class="pres-decision">
      <button type="button" class="pres-choice" data-choice="tape" data-choice-value="yes" aria-pressed="false"><span class="pres-path-label">Yes — there is tape</span><strong>Keep it dry.</strong><span>Do not clean before day 3</span></button>
      <button type="button" class="pres-choice" data-choice="tape" data-choice-value="no" aria-pressed="false"><span class="pres-path-label">No — there is no tape</span><strong>Clean it gently.</strong><span>Clean the edges twice a day. Mix equal parts peroxide and distilled water, then apply antibiotic ointment.</span></button>
    </div>
    <p class="pres-note" aria-live="polite">Choose what you see to focus the instructions.</p>`,
  "s-milestones": `
    <header class="pres-heading"><p class="pres-eyebrow pres-eyebrow--inverse">What happens next</p><h2>Two recovery milestones</h2></header>
    <ol class="pres-timeline">
      <li data-reveal="1"><span>1</span><p>Day 3</p><h3>Shower and wash your hair</h3></li>
      <li data-reveal="2"><span>2</span><p>About 2 weeks</p><h3>Wound check and ear exam</h3></li>
    </ol>
    <aside class="pres-stitch" data-reveal="3"><strong>No stitch removal</strong><span>Your stitches dissolve on their own.</span></aside>`,
  "s-redness": `
    <header class="pres-heading"><p class="pres-eyebrow pres-eyebrow--alert">All three together</p><h2>Call when all three signs are present.</h2></header>
    <ol class="pres-checklist">
      <li data-reveal="1"><span>1</span><strong>Red and swollen</strong></li>
      <li data-reveal="2"><span>2</span><strong>Not improving over 1–2 days</strong></li>
      <li data-reveal="3"><span>3</span><strong>Hurts when touched</strong></li>
    </ol>
    <p class="pres-callout" data-reveal="4"><strong>All three signs:</strong> call your surgeon or clinic.</p>`,
  "s-any": `
    <header class="pres-heading"><p class="pres-eyebrow pres-eyebrow--alert">When to call</p><h2>Call if any one of these is true.</h2></header>
    <ul class="pres-warning-list">
      <li data-reveal="1">Fever above 101.5°F</li>
      <li data-reveal="2">Swelling or fluid building up under the skin behind the ear</li>
      <li data-reveal="3">Headache, light sensitivity, or excessive lethargy</li>
      <li data-reveal="4">Any wound-care question or medical concern</li>
    </ul>
    <p class="pres-callout" data-reveal="5"><strong>Any one sign:</strong> call your surgeon or clinic.</p>`,
  "s-numbers": `
    <header class="pres-heading"><p class="pres-eyebrow">Use the route that matches the situation</p><h2>Who should you call?</h2></header>
    <div class="pres-contact">
      <section data-reveal="1"><p>Routine question</p><a href="tel:+14153532148">415-353-2148</a><h3>Nursing line</h3><span>Leave a message. Expect a callback within 12 hours.</span></section>
      <section data-reveal="2"><p>Emergency or after hours</p><a href="tel:+14154761000">415-476-1000</a><h3>Hospital operator</h3><span>Ask for the Otolaryngology resident on call.</span></section>
    </div>`,
  "s-healing": `
    <div class="pres-copy pres-copy--host"><p class="pres-eyebrow pres-eyebrow--inverse">After healing</p><h2>You return for programming.</h2><p class="pres-dek">This is when the team begins setting up your cochlear implant equipment.</p></div>`,
  "s-programming": `
    <div class="pres-copy pres-copy--action"><p class="pres-eyebrow">Your first programming visit</p><h2>The audiologist connects your processor to a computer.</h2><span class="pres-rule" aria-hidden="true"></span><p class="pres-dek">They adjust the settings and begin teaching your brain to understand the new signal.</p></div>
    <figure class="pres-figure pres-figure--programming"><img src="../assets/illustrations/ci-activation-programming-safety-card-v1.png" alt="An audiologist adjusts a patient's outside-ear speech processor using a computer"></figure>`,
  "s-followup": `
    <div class="pres-copy pres-copy--host"><p class="pres-eyebrow pres-eyebrow--inverse">Ongoing visits</p><h2>Checks and fine-tuning continue.</h2><p class="pres-dek">The team measures how the implant and equipment are working, then adjusts them over time.</p></div>`
};

function buildPresentationScene(scene) {
  const node = document.createElement("section");
  node.dataset.scene = scene.id;
  node.className = `watch-visual pres-slide pres-slide--${scene.id} pres-slide--mode-${scene.mode ?? "focus"}`;
  node.innerHTML = presentationMarkup[scene.id] ?? "";
  if (scene.kind === "host") {
    node.classList.add("pres-slide--host");
    const media = HOST_MEDIA[scene.id];
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "pres-host-media";
    if (!REDUCED && media?.clip) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = media.clip;
      mediaWrap.append(video);
      scene.videoEl = video;
    } else if (media?.poster) {
      const img = document.createElement("img");
      img.src = media.poster;
      img.alt = "Dr. Hoots, the recovery guide";
      mediaWrap.append(img);
    }
    node.append(mediaWrap);
  } else {
    const speaker = document.createElement("aside");
    speaker.className = "pres-speaker-bubble";
    speaker.setAttribute("aria-label", "Dr. Hoots is speaking");
    const media = COACH_MEDIA.scenes[scene.id] ?? null;
    if (scene.intervention) {
      node.classList.add("pres-slide--coach-intervention");
      speaker.classList.add("pres-speaker-bubble--intervention");
    } else {
      node.classList.add("pres-slide--speaker-compact");
    }
    if (!REDUCED && media?.clip) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = media.clip;
      video.poster = media.poster ?? COACH_MEDIA.avatar;
      speaker.append(video);
      scene.videoEl = video;
    } else {
      const img = document.createElement("img");
      img.src = COACH_MEDIA.avatar;
      img.alt = "Dr. Hoots";
      speaker.append(img);
    }
    node.append(speaker);
  }
  return node;
}

/* ---------- build the stage ---------- */
const stage = document.getElementById("watch-stage");
const poster = document.getElementById("watch-poster");
if (EMBEDDED) poster.querySelector("#watch-play")?.childNodes[1]?.replaceWith("Play the guide · ");
for (const scene of SCENES) {
  const node = buildPresentationScene(scene);
  stage.insertBefore(node, poster);
  scene.node = node;
}
if (SCENES.some((scene) => scene.kind === "host"
  ? !scene.node.querySelector(".pres-host-media")
  : !scene.node.querySelector(".pres-speaker-bubble"))) {
  throw new Error("Every Watch scene must retain exactly one Dr. Hoots presence.");
}

/* ---------- elements ---------- */
const el = (id) => document.getElementById(id);
const playPoster = el("watch-play");
const playToggle = el("play-toggle");
const captionBand = el("caption-band");
const caption = el("caption");
const scrubber = el("scrubber");
const timeNow = el("time-now");
const timeTotal = el("time-total");
const speedSelect = el("speed");

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
// Listed durations round to the nearest second so the rail sums to the runtime.
const fmtDur = (s) => fmt(Math.round(s));
timeTotal.textContent = fmt(TOTAL);
el("total-label").textContent = fmt(TOTAL);
const mastheadRuntime = el("masthead-runtime");
if (mastheadRuntime) mastheadRuntime.textContent = fmt(TOTAL);

/* ---------- audio ---------- */
const audioCache = new Map();
function audioFor(trackId) {
  if (!audioCache.has(trackId)) {
    const audio = new Audio(`../${GUIDE_DATA.tracks[trackId].file}`);
    audio.preload = "auto";
    audioCache.set(trackId, audio);
  }
  return audioCache.get(trackId);
}

/* ---------- captions ---------- */
const captionCache = new Map();
function captionNodes(trackId) {
  if (!captionCache.has(trackId)) {
    const track = GUIDE_DATA.tracks[trackId];
    const nodes = [];
    const spans = track.words.map((word, i) => {
      if (i) nodes.push(document.createTextNode(" "));
      const span = document.createElement("span");
      span.className = "w is-coming";
      span.textContent = word.w;
      nodes.push(span);
      return { span, s: word.s, e: word.e };
    });
    captionCache.set(trackId, { nodes, spans });
  }
  return captionCache.get(trackId);
}
function renderCaption(scene, localT) {
  if (!scene.track) {
    caption.textContent = scene.title ? `${scene.eyebrow} · ${scene.title}` : "";
    delete caption.dataset.track;
    return;
  }
  const { nodes, spans } = captionNodes(scene.track);
  if (caption.dataset.track !== scene.track) {
    caption.textContent = "";
    caption.dataset.track = scene.track;
    caption.append(...nodes);
  }
  for (const item of spans) {
    const cls = localT >= item.e ? "w is-said" : localT >= item.s ? "w is-now" : "w is-coming";
    if (item.span.className !== cls) item.span.className = cls;
  }
}

function renderBeat(scene, localT) {
  const track = trackOf(scene);
  const duration = track?.duration ?? scene.dur ?? 1;
  const revealCount = scene.node.querySelectorAll("[data-reveal]").length;
  if (!revealCount) {
    scene.node.dataset.beat = "0";
    return;
  }
  const progress = Math.min(1, Math.max(0, localT / duration));
  const beat = Math.min(revealCount, Math.max(1, Math.ceil(progress * revealCount)));
  scene.node.dataset.beat = String(beat);
  scene.node.querySelectorAll("[data-reveal]").forEach((item) => {
    item.classList.toggle("is-revealed", Number(item.dataset.reveal) <= beat);
  });
}

/* ---------- chapters + storyboard ---------- */
const chapterNav = el("chapter-nav");
const chapterNavFull = el("chapter-nav-full");
const chapterSelect = el("chapter-select");
const chapterCount = el("chapter-count");
const chapterPrev = el("chapter-prev");
const chapterNext = el("chapter-next");
const boardList = el("board-list");
const chapters = [];
const boardRows = new Map();
const CHECK_SVG = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6.5 L4.8 9.3 L10 3.6" stroke="#14828c" stroke-width="2" fill="none"></path></svg>';

(function build() {
  const byId = (id) => SCENES.find((scene) => scene.id === id);
  const groups = [
    { name: "Opening", chapters: [{ label: "Welcome", ids: ["intro"] }] },
    { name: "Part 1 · Care for the surgery site", chapters: [
      { num: "01", label: "Day 2: bandage off, check for tape", ids: ["s-day2"] },
      { num: "02–03", label: "The two paths", ids: ["s-paths"] },
      { num: "04–05", label: "The next milestones", ids: ["s-milestones"] }
    ] },
    { name: "Part 2 · When to call", chapters: [
      { num: "06", label: "Redness: all three signs", ids: ["s-redness"] },
      { num: "07–10", label: "Also call for any of these", ids: ["s-any"] },
      { num: "11", label: "The numbers to use", ids: ["s-numbers"] }
    ] },
    { name: "Part 3 · First programming visits", chapters: [
      { num: "12", label: "After healing", ids: ["s-healing"] },
      { num: "13", label: "Your first programming visit", ids: ["s-programming"] },
      { num: "14", label: "Visits that continue", ids: ["s-followup"] }
    ] }
  ];

  for (const group of groups) {
    const wrap = document.createElement("div");
    wrap.className = "chapter-nav__group";
    const title = document.createElement("p");
    title.className = "chapter-nav__title";
    title.textContent = group.name;
    wrap.append(title);
    const list = document.createElement("ul");
    list.className = "chapter-nav__list";
    for (const chapter of group.chapters) {
      const scenes = chapter.ids.map(byId).filter(Boolean);
      const start = scenes[0].start;
      const seekStart = scenes.find((scene) => scene.track)?.start ?? start;
      const dur = scenes.reduce((sum, scene) => sum + scene.dur, 0);
      // Round chapter boundaries, not durations, so listed times telescope to the exact runtime.
      const shownDur = Math.round(start + dur) - Math.round(start);
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chapter-button";
      button.innerHTML = `<span class="chapter-button__num">${chapter.num ?? ""}</span><span class="chapter-button__label"><span>${chapter.label}</span>${CHECK_SVG}</span><span class="chapter-button__duration">${fmt(shownDur)}</span>`;
      button.addEventListener("click", () => {
        seek(seekStart);
        if (!state.playing) play();
      });
      li.append(button);
      list.append(li);
      const chapterIndex = chapters.length;
      const option = document.createElement("option");
      option.value = String(chapterIndex);
      option.textContent = chapter.label;
      chapterSelect.append(option);
      chapters.push({ button, label: chapter.label, start, seekStart, end: start + dur });
    }
    wrap.append(list);
    chapterNavFull.append(wrap);
  }

  for (const scene of SCENES) {
    if (!scene.track) continue;
    const frame = scene.frame;
    const track = trackOf(scene);
    const row = document.createElement("li");
    row.className = "board-row";
    const num = frame ? frame.numLabel ?? String(frame.number).padStart(2, "0") : scene.num ?? "—";
    const sceneTitle = frame ? frame.title : "Welcome";
    const treatment = scene.kind === "host" ? "Host-led" : "Diagram-led";
    const meta = `${treatment} · ${fmtDur(track.duration ?? 0)} narration · ${scene.track}`;
    const onFrame = frame ? frame.onFrameText.join(" · ") : "None — the host owns the stage.";
    const needs = frame
      ? frame.illustrationNeed
      : "A speaking cochlear-implant welcome performance; the approved silent clip stands in for now.";
    const motion = frame ? frame.videoMotion : "Calm blink and head tilt from the approved clip; no gesture.";
    row.innerHTML = `
      <span class="board-row__num">${num}</span>
      <div class="board-row__scene"><b>${sceneTitle}</b><span class="board-row__meta">${meta}</span></div>
      <p class="board-row__cell">“${track.text}”</p>
      <p class="board-row__cell">${onFrame}</p>
      <p class="board-row__cell">${needs} ${motion}</p>`;
    boardList.append(row);
    boardRows.set(scene.id, row);
  }
})();

function markChapters() {
  let currentChapter = chapters.length - 1;
  chapters.forEach((chapter, index) => {
    const current = state.t >= chapter.start && state.t < chapter.end;
    if (current) currentChapter = index;
    chapter.button.classList.toggle("is-current", current);
    chapter.button.classList.toggle("is-complete", !current && chapter.end <= state.t + 0.05);
  });
  const chapter = chapters[currentChapter];
  chapterSelect.value = String(currentChapter);
  chapterCount.textContent = `${currentChapter + 1} of ${chapters.length}`;
  chapterPrev.disabled = currentChapter === 0;
  chapterNext.disabled = currentChapter === chapters.length - 1;
  chapterPrev.dataset.chapter = String(currentChapter);
  chapterNext.dataset.chapter = String(currentChapter + 2);
}

/* ---------- scene switching ---------- */
let currentIndex = -1;
function sceneAt(t) {
  for (let i = 0; i < SCENES.length; i += 1) {
    if (t < SCENES[i].start + SCENES[i].dur) return i;
  }
  return SCENES.length - 1;
}
function enterScene(index) {
  currentIndex = index;
  const scene = SCENES[index];
  for (const item of SCENES) {
    const active = item === scene;
    item.node.classList.toggle("is-active", active);
    const field = item.node.querySelector(".sc-field");
    if (field) field.classList.toggle("is-active", active);
  }
  captionBand.classList.toggle("is-hostled", scene.kind === "host");
  captionBand.classList.toggle("is-silent", !scene.track);
  for (const [trackId, audio] of audioCache) {
    if (trackId !== scene.track && !audio.paused) audio.pause();
  }
  for (const item of SCENES) {
    if (item.videoEl && item !== scene && !item.videoEl.paused) item.videoEl.pause();
  }
  markChapters();
  boardRows.forEach((row, id) => row.classList.toggle("is-current", id === scene.id));
  const next = SCENES[index + 1];
  if (next?.track) audioFor(next.track);
}

/* ---------- clock ---------- */
const state = { playing: false, t: 0, rate: 1 };
let lastTick = null;
let seeking = false;

function syncHost(scene, localT) {
  const video = scene.videoEl;
  if (!video) return;
  const target = Math.min(localT, Math.max((video.duration || 99) - 0.05, 0));
  if (Math.abs((video.currentTime || 0) - target) > 0.4) video.currentTime = target;
  if (state.playing && video.paused && !video.ended) video.play().catch(() => {});
  if (!state.playing && !video.paused) video.pause();
}

function tick(now) {
  if (lastTick == null) lastTick = now;
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  if (state.playing && !seeking) {
    const scene = SCENES[sceneAt(state.t)];
    const track = trackOf(scene);
    if (track) {
      const audio = audioFor(scene.track);
      if (!audio.paused && !audio.ended) {
        state.t = scene.start + Math.min(audio.currentTime, track.duration ?? audio.currentTime);
      } else if (audio.ended || state.t - scene.start >= (track.duration ?? 0)) {
        state.t += dt * state.rate;
      } else {
        audio.playbackRate = state.rate;
        audio.currentTime = Math.max(0, state.t - scene.start);
        audio.play().catch(() => {});
      }
    } else {
      state.t += dt * state.rate;
    }
    if (state.t >= TOTAL) {
      state.t = TOTAL;
      pause();
      poster.classList.add("is-hidden");
      playToggle.textContent = "Replay";
    }
  }

  const index = sceneAt(state.t);
  if (index !== currentIndex) enterScene(index);
  const scene = SCENES[index];
  const localT = state.t - scene.start;
  renderCaption(scene, localT);
  renderBeat(scene, localT);
  syncHost(scene, localT);
  if (!seeking) scrubber.value = Math.round((state.t / TOTAL) * 1000);
  timeNow.textContent = fmt(state.t);
  requestAnimationFrame(tick);
}

function play() {
  state.playing = true;
  poster.classList.add("is-hidden");
  playToggle.textContent = "Pause";
  playToggle.setAttribute("aria-pressed", "true");
}
function pause() {
  state.playing = false;
  playToggle.textContent = "Play";
  playToggle.setAttribute("aria-pressed", "false");
  for (const audio of audioCache.values()) if (!audio.paused) audio.pause();
  for (const item of SCENES) if (item.videoEl && !item.videoEl.paused) item.videoEl.pause();
}
function seek(t) {
  state.t = Math.min(Math.max(t, 0), TOTAL - 0.01);
  if (!state.playing) playToggle.textContent = "Play";
  const scene = SCENES[sceneAt(state.t)];
  const track = trackOf(scene);
  if (track) {
    const audio = audioFor(scene.track);
    audio.playbackRate = state.rate;
    const localT = state.t - scene.start;
    if (localT < (track.duration ?? 0)) {
      audio.currentTime = Math.max(0, localT);
      if (state.playing) audio.play().catch(() => {});
    } else if (!audio.paused) audio.pause();
  }
}

/* ---------- wiring ---------- */
playPoster.addEventListener("click", () => {
  if (state.t >= TOTAL - 0.05) state.t = 0;
  play();
});
playToggle.addEventListener("click", () => {
  if (state.playing) {
    pause();
    return;
  }
  if (state.t >= TOTAL - 0.05) seek(0);
  play();
});
scrubber.addEventListener("input", () => {
  seeking = true;
  timeNow.textContent = fmt((Number(scrubber.value) / 1000) * TOTAL);
});
scrubber.addEventListener("change", () => {
  seeking = false;
  seek((Number(scrubber.value) / 1000) * TOTAL);
});
speedSelect.addEventListener("change", () => {
  state.rate = Number(speedSelect.value);
  for (const audio of audioCache.values()) audio.playbackRate = state.rate;
});
chapterPrev.addEventListener("click", () => {
  const index = Math.max(0, chapters.findIndex((chapter) => state.t >= chapter.start && state.t < chapter.end) - 1);
  seek(chapters[index].seekStart);
  play();
});
chapterNext.addEventListener("click", () => {
  const current = chapters.findIndex((chapter) => state.t >= chapter.start && state.t < chapter.end);
  seek(chapters[Math.min(chapters.length - 1, Math.max(0, current + 1))].seekStart);
  play();
});
chapterSelect.addEventListener("change", () => {
  const chapter = chapters[Number(chapterSelect.value)];
  if (!chapter) return;
  seek(chapter.seekStart);
  poster.classList.add("is-hidden");
});
stage.addEventListener("click", (event) => {
  const choice = event.target.closest("[data-choice]");
  if (choice) {
    const group = choice.dataset.choice;
    choice.closest(".pres-slide").querySelectorAll(`[data-choice="${group}"]`).forEach((item) => {
      const selected = item === choice;
      item.classList.toggle("is-selected", selected);
      item.classList.toggle("is-muted", !selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    const note = choice.closest(".pres-slide").querySelector(".pres-note");
    if (note) note.textContent = choice.dataset.choiceValue === "yes" ? "Tape path selected: keep it dry before day 3." : "No-tape path selected: follow the gentle cleaning steps.";
    return;
  }
  const target = event.target.closest("[data-scene-target]");
  if (!target) return;
  const scene = SCENES.find((item) => item.id === target.dataset.sceneTarget);
  if (!scene) return;
  seek(scene.start);
  poster.classList.add("is-hidden");
  play();
});
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, textarea, button, summary, a")) return;
  if (event.code === "Space" || event.key === "k") {
    event.preventDefault();
    state.playing ? pause() : play();
  } else if (event.key === "ArrowRight") seek(state.t + 5);
  else if (event.key === "ArrowLeft") seek(state.t - 5);
  else if (event.key === "Home") seek(0);
});

enterScene(0);
requestAnimationFrame(tick);

// QA hook for scripted review; not part of the player UI.
window.__animatic = { seek, play, pause, state, SCENES, TOTAL };
