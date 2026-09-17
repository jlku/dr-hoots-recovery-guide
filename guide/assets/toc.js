// guide/assets/toc.js
import { assetUrl, loadGuide } from "./data.js";
import { LANGUAGES, availableLanguages, buildFragment, formatTime, normalizeLanguage, parseFragment, pickEntry } from "./logic.js";

const SUBTITLES_KEY = "recovery-guide-subtitles";
const dom = {
  title: document.querySelector("#guide-title"),
  subtitle: document.querySelector("#guide-subtitle"),
  list: document.querySelector("#segment-list"),
  language: document.querySelector("#language"),
  languageLabel: document.querySelector("#language-label"),
  subtitles: document.querySelector("#subtitles-toggle"),
  subtitlesLabel: document.querySelector("#subtitles-label"),
  card: document.querySelector("#card-link"),
  badges: document.querySelector("#review-badges"),
  reviewHeading: document.querySelector("#review-heading"),
  notice: document.querySelector("#notice"),
  fallback: document.querySelector("#fallback-notice")
};

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

function thumbnail(segment, guide) {
  const firstBeat = segment.beats.find((beat) => !beat.condition) ?? segment.beats[0];
  const frame = guide.frames.frames[firstBeat.frame];
  const box = document.createElement("div");
  box.className = "thumb";
  if (frame?.src) {
    const image = document.createElement("img");
    image.src = assetUrl(frame.src);
    image.alt = "";
    image.loading = "lazy";
    box.append(image);
  } else {
    box.classList.add("thumb--text");
    box.textContent = String(segment.number).padStart(2, "0");
  }
  return box;
}

function renderBadges(guide) {
  const labels = guide.pack.labels;
  const entries = guide.reviews?.entries ?? [];
  const items = entries.length ? entries : [{ label: labels["ui.not_reviewed"], date: null, status: null }];
  dom.badges.replaceChildren(...items.map((item) => {
    const badge = document.createElement("li");
    badge.className = "badge";
    badge.textContent = [item.label, item.status, item.date].filter(Boolean).join(" · ");
    return badge;
  }));
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

function renderList(guide, params) {
  const labels = guide.pack.labels;
  dom.list.replaceChildren(...guide.segments.segments.map((segment) => {
    const item = document.createElement("li");
    item.className = "segment";
    const link = document.createElement("a");
    link.className = "segment__link";
    link.href = `watch.html${buildFragment({ ...params, l: guide.language, s: segment.number })}`;
    const number = document.createElement("span");
    number.className = "segment__number";
    number.textContent = String(segment.number).padStart(2, "0");
    const title = document.createElement("span");
    title.className = "segment__title";
    title.textContent = labels[segment.title_key] ?? "";
    const meta = document.createElement("span");
    meta.className = "segment__meta";
    const picked = pickEntry(guide.index, segment.number, guide.language);
    meta.textContent = [labels[segment.chip_key], picked.entry ? formatTime(picked.entry.duration_seconds) : null].filter(Boolean).join(" · ");
    link.append(thumbnail(segment, guide), number, title, meta);
    item.append(link);
    return item;
  }));
}

async function init() {
  const params = parseFragment(location.hash);
  const guide = await loadGuide(params.l);
  const labels = guide.pack.labels;
  document.documentElement.lang = guide.pack.language;
  document.title = labels["guide.title"];
  dom.title.textContent = labels["guide.title"];
  dom.subtitle.textContent = labels["guide.subtitle"];
  dom.languageLabel.textContent = labels["ui.language"];
  dom.subtitlesLabel.textContent = labels["ui.subtitles"];
  dom.card.textContent = labels["ui.card"];
  dom.notice.textContent = labels["ui.notice"];
  dom.reviewHeading.textContent = labels["ui.review_status"];
  dom.fallback.textContent = labels["ui.language_fallback"];
  dom.fallback.hidden = !guide.packFallback;
  dom.subtitles.checked = readPreference();
  renderLanguages(guide);
  renderList(guide, params);
  renderBadges(guide);
  window.__guideContents = { getState: () => ({ language: guide.language, segments: guide.segments.segments.length, fallback: guide.packFallback }) };
}

function showError(error) {
  dom.notice.textContent = error.message;
}

dom.language.addEventListener("change", () => {
  location.hash = buildFragment({ ...parseFragment(location.hash), l: normalizeLanguage(dom.language.value) });
});
dom.subtitles.addEventListener("change", () => writePreference(dom.subtitles.checked));
window.addEventListener("hashchange", () => init().catch(showError));
init().catch(showError);
