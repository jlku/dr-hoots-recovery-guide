// guide/assets/provider-page.js
// The provider page: paste the dot-phrase block, check and change what the guide will use, see every line
// the guide does not use, and copy the patient link. The block is the one source of truth: a change in the
// table rewrites its line, so the note and the link agree. It reads static content files only; nothing
// the provider pastes leaves the browser tab.
import { assetUrl, canonicalSentences, fetchJson } from "./data.js";
import { LANGUAGES, formatFollowUp } from "./logic.js";
import { FIELD_ORDER, applyPresets, buildPatientLink, coveredSentences, lineStatuses, missingFromBlock, parseProviderBlock, writeFieldLine } from "./provider.js";

const byId = (id) => document.getElementById(id);
const dom = {
  block: byId("block"),
  rows: byId("parsed").querySelector("tbody"),
  notUsed: byId("not-used"),
  notUsedSummary: byId("not-used-summary"),
  notUsedList: byId("not-used-list"),
  contradicts: byId("contradicts"),
  contradictsCount: byId("contradicts-count"),
  contradictsSummary: byId("contradicts-summary"),
  contradictsList: byId("contradicts-list"),
  ackRow: byId("ack-row"),
  ack: byId("ack"),
  ackText: byId("ack-text"),
  newPatient: byId("new-patient"),
  restoreOffer: byId("restore-offer"),
  restoreText: byId("restore-text"),
  restore: byId("restore"),
  discard: byId("discard"),
  unreadBlock: byId("unread-block"),
  unread: byId("unread"),
  alsoSays: byId("also-says"),
  alsoSaysList: byId("also-says-list"),
  kept: byId("kept"),
  keptSummary: byId("kept-summary"),
  keptList: byId("kept-list"),
  link: byId("patient-link"),
  linkState: byId("link-state"),
  copy: byId("copy-link"),
  editState: byId("edit-state"),
  editHome: byId("edit-home"),
  editSaid: byId("edit-said"),
  undo: byId("undo-edit"),
  open: byId("open-guide")
};
const STORE_KEY = "avs-provider-block";
// The differences the provider has said they have read. It holds the exact lines, so editing the block
// takes the tick back.
let acknowledged = null;
const LABELS = { antibiotic: "Antibiotic", pain_medication: "Pain medication", follow_up_date: "Follow-up", language: "Language", reviewed: "Reviewed by" };
// What the page rewrote, named the way a clinician would say it.
const WROTE = { antibiotic: "antibiotic answer", pain_medication: "pain medication answer", follow_up_date: "follow-up date", language: "guide language" };
const MEDICATION_SENTENCE = { antibiotic: "med.01", pain_medication: "med.03" };
const NO_WORDING = { antibiotic: "antibiotic", pain_medication: "prescription pain medicine" };
// What the frame shows when the link carries no date, and the wait it stands for.
const FALLBACK_WAIT = "about two weeks after surgery";
const FALLBACK_DAYS = 14;

const [presetFile, lineMap, canonical, segmentFile, templateText] = await Promise.all([
  fetchJson("content/provider/presets.json"),
  fetchJson("content/provider/template-lines.json"),
  fetchJson("content/canonical/ci-phase0-v0.1.0.json"),
  fetchJson("content/segments/ci-phase0-v0.1.0.segments.json"),
  fetch(assetUrl("content/provider/dot-phrase-draft.txt")).then((response) => response.text())
]);
const sentences = canonicalSentences(canonical);
const chapterOf = new Map(segmentFile.segments.flatMap((segment) => segment.beats.flatMap((beat) => (beat.sentence_ids ?? []).map((id) => [id, segment.number]))));
const template = parseProviderBlock(templateText).other;
const presets = presetFile.presets;
// Until a clinic approves them these are offers, never answers. See content/provider/presets.json.
const presetsApproved = presetFile.approved === true;
const covered = coveredSentences(lineMap);

function element(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

function quote(ids) {
  return ids.map((id) => sentences.get(id)).filter(Boolean).join(" ");
}

// What the last table edit did, so the page can offer to undo it by name.
let lastEdit = null;

// The clinician's block goes back into the chart, so an edit they did not mean must be reversible the way
// every other edit in the browser is. Assigning textarea.value wipes the native undo stack, so Ctrl-Z did
// nothing after a table click. Writing through the browser's own edit path keeps one undo history for
// typing and for our writes alike; where that path is unavailable the page falls back and the Undo button
// beside the table is the only way back, which is why the button exists whether or not Ctrl-Z works.
function writeBlock(next) {
  const previous = dom.block.value;
  if (next === previous) return previous;
  const active = document.activeElement;
  let wrote = false;
  try {
    dom.block.focus();
    dom.block.setSelectionRange(0, previous.length);
    wrote = document.execCommand("insertText", false, next) && dom.block.value === next;
  } catch {
    wrote = false;
  }
  if (!wrote) dom.block.value = next;
  if (active && active !== dom.block && typeof active.focus === "function") active.focus();
  return previous;
}

function apply(field, value) {
  const { text, outcome, kept, tail } = writeFieldLine(dom.block.value, field, value);
  const previous = writeBlock(text);
  lastEdit = { field, previous, outcome, kept, tail };
  render();
}

function undoLastEdit() {
  if (!lastEdit) return;
  writeBlock(lastEdit.previous);
  lastEdit = null;
  render();
}

// A note is a string, or { text, notInGuide } for one that names something the patient will not see.
function row(field, control, from, notes = [], needsChoice = false) {
  const tr = element("tr", { className: needsChoice ? "needs-choice" : from === "preset" ? "is-preset" : "" });
  tr.dataset.field = field;
  const paragraphs = notes.map((note) => {
    const paragraph = element("p", { className: "row-note", textContent: typeof note === "string" ? note : note.text });
    if (note.notInGuide) paragraph.dataset.notInGuide = "";
    return paragraph;
  });
  tr.append(
    element("th", { scope: "row", textContent: LABELS[field] }),
    element("td", {}, control, ...paragraphs),
    element("td", { className: "row-from", textContent: from })
  );
  return tr;
}

function yesNo(field, value, disabled) {
  const group = element("div", { className: "choice", role: "radiogroup" });
  group.setAttribute("aria-label", LABELS[field]);
  for (const [label, answer] of [["Yes", true], ["No", false]]) {
    const button = element("button", { type: "button", className: "choice__option", textContent: label, disabled });
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(value === answer));
    button.dataset.focus = `${field}-${label}`;
    button.addEventListener("click", () => apply(field, answer));
    group.append(button);
  }
  return group;
}

// The clinic's unapproved default, offered by name instead of applied in silence.
function offerButton(field, label) {
  const button = element("button", { type: "button", className: "row-offer", textContent: label });
  button.dataset.focus = `offer-${field}`;
  button.addEventListener("click", () => apply(field, presets[field]));
  return button;
}

function medicationRow(field, parsed, values, fromPresets, unauthored) {
  const needsChoice = parsed.needs_choice.includes(field) || unauthored.includes(field);
  const value = needsChoice ? null : values[field];
  const notes = [];
  const conflict = parsed.conflicts.find((entry) => entry.field === field);
  if (conflict) notes.push(`Your block says both ${conflict.lines.map((line) => `"${line}"`).join(" and ")}. Choose one.`);
  else if (parsed.unclear[field]) notes.push(`This page cannot read "${parsed.unclear[field]}" as a yes or a no. Choose one.`);
  else if (unauthored.includes(field)) notes.push(`Your note says nothing about this, so this page will not guess. Your clinic's draft default is ${presets[field] ? "Yes" : "No"}, and nobody has confirmed it yet.`);
  if (value === true) notes.push(`The guide says: "${sentences.get(MEDICATION_SENTENCE[field])}"`);
  else if (value === false) notes.push(`The guide leaves this out. It has no wording yet for patients who get no ${NO_WORDING[field]}, and says nothing about it until your clinic gives us that wording.`);
  if (value !== null && parsed.details[field]) notes.push({ text: `Not shown to the patient: "${parsed.details[field]}". It stays in your note.`, notInGuide: true });
  const from = needsChoice ? "Choose one" : fromPresets.includes(field) ? "preset" : "your block";
  const control = element("div", { className: "row-control" }, yesNo(field, value, false));
  if (unauthored.includes(field)) control.append(offerButton(field, `Use the draft default (${presets[field] ? "Yes" : "No"})`));
  return row(field, control, from, notes, needsChoice);
}

// The guide's fallback wait has to fall inside what the note said, or the patient reads a different one.
function intervalAgrees(interval) {
  return interval.days_from <= FALLBACK_DAYS && FALLBACK_DAYS <= interval.days_to;
}

function followUpRow(values, fromPresets, language, parsed) {
  const needsChoice = parsed.needs_choice.includes("follow_up_date");
  const wrap = element("div", { className: "row-control" });
  const input = element("input", { type: "date", value: values.follow_up_date ?? "", className: "row-input" });
  input.setAttribute("aria-label", "Follow-up date");
  input.dataset.focus = "follow-up";
  input.addEventListener("change", () => apply("follow_up_date", input.value || null));
  wrap.append(input);
  if (values.follow_up_date || needsChoice) {
    const clear = element("button", { type: "button", className: "row-clear", textContent: needsChoice ? "Use \u201cabout two weeks\u201d" : "Clear" });
    clear.addEventListener("click", () => apply("follow_up_date", null));
    wrap.append(clear);
  }
  if (needsChoice) {
    const conflict = parsed.conflicts.find((entry) => entry.field === "follow_up_date");
    const said = conflict ? conflict.lines.map((line) => `"${line}"`).join(" and ") : `"${parsed.unclear.follow_up_date}"`;
    return row("follow_up_date", wrap, "Choose one", [`This page cannot read ${said} as one date. Pick the date, or use "about two weeks".`], true);
  }
  const interval = parsed.intervals?.follow_up_date;
  const notes = values.follow_up_date
    ? [`The guide shows "Your wound check and ear exam: ${formatFollowUp(values.follow_up_date, "en")}".${language !== "en" ? " (Shown in the patient's language.)" : ""}`]
    : interval
      // Real handouts give an interval, never a bookable date. The page says what the note said, and
      // whether the guide's own wait agrees with it.
      ? [`Your note says "${interval.line ?? interval.text}", which is not a date this page can put in the guide.`,
         intervalAgrees(interval)
           ? `Without a date the guide shows "${FALLBACK_WAIT}", which agrees with your note.`
           : `Without a date the guide shows "${FALLBACK_WAIT}" \u2014 a different wait from the one you wrote. Set the date, or the patient reads the wrong one.`]
      : [`The guide says "${FALLBACK_WAIT}".`];
  return row("follow_up_date", wrap, fromPresets.includes("follow_up_date") ? "preset" : "your block", notes, false);
}

function languageRow(values, fromPresets, needsChoice, unauthored) {
  const select = element("select", { className: "row-input" });
  select.setAttribute("aria-label", "Guide language");
  select.dataset.focus = "language";
  for (const language of LANGUAGES) select.append(element("option", { value: language.code, textContent: language.label, selected: language.code === values.language && !needsChoice }));
  if (needsChoice) select.prepend(element("option", { value: "", textContent: "Choose a language", selected: true, disabled: true }));
  select.addEventListener("change", () => apply("language", select.value));
  const wrap = element("div", { className: "row-control" }, select);
  const notes = [];
  if (needsChoice && !unauthored) notes.push("Your block names a language this page cannot read. Choose one.");
  if (unauthored) {
    notes.push("Your note does not say which language this patient reads, so this page will not guess.");
    wrap.append(offerButton("language", "Use the draft default (English)"));
  }
  return row("language", wrap, needsChoice || unauthored ? "Choose one" : fromPresets.includes("language") ? "preset" : "your block", notes, needsChoice || unauthored);
}

function reviewedRow(reviewed) {
  const wrap = element("div", { className: "row-control" });
  const by = element("input", { type: "text", value: reviewed?.by ?? "", placeholder: "Name", className: "row-input row-input--name" });
  const date = element("input", { type: "date", value: reviewed?.date ?? "", className: "row-input" });
  by.setAttribute("aria-label", "Reviewed by");
  date.setAttribute("aria-label", "Review date");
  by.dataset.focus = "reviewed-by";
  date.dataset.focus = "reviewed-date";
  const commit = () => {
    if (by.value.trim() && date.value) apply("reviewed", { by: by.value.trim(), date: date.value });
    else if (!by.value.trim() && !date.value) apply("reviewed", null);
  };
  by.addEventListener("change", commit);
  date.addEventListener("change", commit);
  wrap.append(by, date);
  // The patient's guide shows no reviewer line, so neither the name nor the date leaves this page.
  const note = reviewed
    ? { text: "Not shown to the patient, and not carried in the link. It stays in your note.", notInGuide: true }
    : { text: "Stays in your note. The patient's guide shows no reviewer line.", notInGuide: true };
  return row("reviewed", wrap, reviewed ? "your block" : "none", [note], false);
}

function lineItem(entry) {
  const item = element("li", { className: `line line--${entry.status}` });
  if (entry.status !== "same") item.dataset.notInGuide = "";
  item.append(element("code", { className: "line__text", textContent: entry.text }));
  let message;
  if (entry.status === "changed") {
    const chapter = chapterOf.get(entry.sentences[0]);
    message = `You changed this, but the patient will hear the guide's reviewed wording in chapter ${chapter}: "${quote(entry.sentences)}"`;
  } else if (entry.status === "not_covered") {
    message = "The guide says nothing about this. Tell the patient another way.";
  } else if (entry.status === "same") {
    message = `The guide says this in chapter ${chapterOf.get(entry.sentences[0])}.`;
  } else {
    message = "Stays in your note.";
  }
  if (entry.placeholder) message += " It still has a blank to fill.";
  item.append(element("p", { className: "line__note", textContent: message }));
  return item;
}

// A line the guide contradicts is not an omission: the patient is told something else. It gets its own
// block, its own count, and the provider's word that they have read it.
function contradictionItem(entry) {
  const item = element("li", { className: "line line--contradicts" });
  item.dataset.notInGuide = "";
  item.append(
    element("p", { className: "line__label", textContent: "You wrote" }),
    element("code", { className: "line__text", textContent: entry.text }),
    element("p", { className: "line__label", textContent: `The patient is told, in chapter ${chapterOf.get(entry.sentences[0])}` }),
    element("p", { className: "line__heard", textContent: `“${quote(entry.sentences)}”` })
  );
  return item;
}

function render() {
  const text = dom.block.value;
  try {
    if (text) sessionStorage.setItem(STORE_KEY, text);
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Private windows can refuse storage; the page works without it.
  }
  dom.newPatient.hidden = text.trim() === "";
  const focusKey = document.activeElement?.dataset?.focus;
  const parsed = parseProviderBlock(text);
  const { values, from_presets: fromPresets, unauthored } = applyPresets(parsed.fields, presets, { approved: presetsApproved });
  dom.rows.replaceChildren(
    medicationRow("antibiotic", parsed, values, fromPresets, unauthored),
    medicationRow("pain_medication", parsed, values, fromPresets, unauthored),
    followUpRow(values, fromPresets, values.language, parsed),
    languageRow(values, fromPresets, parsed.needs_choice.includes("language"), unauthored.includes("language")),
    reviewedRow(parsed.fields.reviewed)
  );
  if (focusKey) dom.rows.querySelector(`[data-focus="${focusKey}"]`)?.focus();

  const statuses = lineStatuses(parsed.other, { template, covered, noteOnly: lineMap.note_only });
  const contradictions = statuses.filter((entry) => entry.status === "changed");
  // A follow-up the note states as an interval is not a line of the block, but it contradicts the guide
  // in exactly the same way when the guide's fallback wait is not the one the clinician wrote.
  const interval = parsed.intervals?.follow_up_date;
  if (interval && !values.follow_up_date && !intervalAgrees(interval)) {
    contradictions.push({
      text: interval.line ?? `Follow-up: ${interval.text}`,
      sentences: [],
      heard: `Your wound check and ear exam: ${FALLBACK_WAIT}`,
      chapter: chapterOf.get("wc.09")
    });
  }
  dom.contradictsList.replaceChildren(...contradictions.map(contradictionItem));
  dom.contradictsCount.textContent = String(contradictions.length);
  dom.contradictsSummary.textContent = contradictions.length === 1
    ? "line of yours says the opposite of what this patient will hear"
    : "lines of yours say the opposite of what this patient will hear";
  dom.contradicts.hidden = contradictions.length === 0;
  const missingLines = statuses.filter((entry) => entry.status === "not_covered");
  dom.notUsedList.replaceChildren(...missingLines.map(lineItem));
  dom.notUsedSummary.textContent = missingLines.length === 1 ? "1 line in your block will not reach this patient." : `${missingLines.length} lines in your block will not reach this patient.`;
  dom.notUsed.hidden = missingLines.length === 0;
  const missing = missingFromBlock(parsed.other, { covered });
  dom.alsoSaysList.replaceChildren(...missing.map((entry) => {
    const item = element("li", { className: "line line--also" });
    item.append(element("p", { className: "line__note", textContent: `Chapter ${chapterOf.get(entry.sentences[0])}: "${quote(entry.sentences)}"` }));
    return item;
  }));
  dom.alsoSays.hidden = missing.length === 0;
  const kept = statuses.filter((entry) => entry.status === "same" || entry.status === "note");
  dom.keptList.replaceChildren(...kept.map(lineItem));
  dom.keptSummary.textContent = kept.length === 1 ? "1 other line: matches the guide or stays in your note" : `${kept.length} other lines: match the guide or stay in your note`;
  dom.kept.hidden = kept.length === 0;
  dom.unread.replaceChildren(...parsed.unfilled.map((line) => element("li", { className: "line" }, element("code", { className: "line__text", textContent: line }), element("p", { className: "line__note", textContent: "Not filled in or not readable, so the value in the table applies. Change it there." }))));
  dom.unreadBlock.hidden = parsed.unfilled.length === 0;

  // What the last table edit did to the clinician's own text, in their words, with a way back.
  if (lastEdit) {
    const label = LABELS[lastEdit.field];
    const said = lastEdit.outcome === "added"
      ? `${label} was not in your block, so this page added a line for it.`
      : lastEdit.outcome === "kept"
        ? `Your ${label.toLowerCase()} line still says \u201c${lastEdit.kept}\u201d. This page did not change your words; the link uses what you chose.`
        : lastEdit.tail
          ? `Rewrote the ${WROTE[lastEdit.field]} only. Your line still says \u201c${lastEdit.tail}\u201d \u2014 check it before this goes back in the chart.`
          : `Rewrote the ${WROTE[lastEdit.field]} in your block.`;
    dom.editSaid.textContent = said;
    dom.editState.hidden = false;
    dom.editState.dataset.attention = lastEdit.outcome === "kept" || lastEdit.tail ? "" : "quiet";
    // It belongs against the control that caused it, not a screen below: the clinician clicked here.
    dom.rows.querySelector(`tr[data-field="${lastEdit.field}"] td`)?.append(dom.editState);
  } else {
    dom.editState.hidden = true;
    dom.editHome.append(dom.editState);
  }

  const signature = contradictions.map((entry) => entry.text).join("\u0000");
  dom.ackRow.hidden = contradictions.length === 0;
  dom.ackText.textContent = contradictions.length === 1
    ? "I have read the difference above, and I will tell this patient myself."
    : `I have read the ${contradictions.length} differences above, and I will tell this patient myself.`;
  // Editing the block re-arms the box: a tick covers the differences it was ticked for, not the next ones.
  if (signature !== acknowledged) acknowledged = null;
  dom.ack.dataset.signature = signature;
  dom.ack.checked = signature !== "" && signature === acknowledged;

  // A value with no author blocks the link exactly as an unreadable one does: absence, mislabelling and
  // unreadability are one object, because the patient cannot tell them apart.
  const pending = FIELD_ORDER.filter((field) => parsed.needs_choice.includes(field) || unauthored.includes(field)).map((field) => LABELS[field]);
  // A contradiction the clinician can actually fix here asks them to fix it. Ticking a box to accept a
  // wait you can correct with one date picker is a worse outcome than being made to correct it.
  const needsDate = Boolean(interval) && !values.follow_up_date && !intervalAgrees(interval);
  const blocked = pending.length
    ? `Choose ${pending.join(" and ")} in the table before you send a link.`
    : needsDate
      ? `Your note says "${interval.line ?? interval.text}". Set the follow-up date, because the guide cannot say that \u2014 without a date it shows "${FALLBACK_WAIT}".`
    : contradictions.length && signature !== acknowledged
      ? `This patient's guide contradicts ${contradictions.length === 1 ? "a line" : `${contradictions.length} lines`} in your block. Read ${contradictions.length === 1 ? "it" : "them"} and tick the box before you send a link.`
      : null;
  if (blocked) {
    dom.link.removeAttribute("href");
    dom.link.textContent = "";
    dom.link.hidden = true;
    dom.copy.disabled = true;
    dom.open.removeAttribute("href");
    dom.open.setAttribute("aria-disabled", "true");
    dom.linkState.textContent = blocked;
    dom.linkState.className = "provider__link-state is-blocked";
    return;
  }
  const link = buildPatientLink(values, new URL("index.html", location.href).href);
  dom.link.hidden = false;
  dom.link.href = link;
  dom.link.textContent = link;
  dom.copy.disabled = false;
  dom.open.href = link;
  dom.open.removeAttribute("aria-disabled");
  dom.linkState.textContent = "";
  dom.linkState.className = "provider__link-state";
}

// The page never opens holding a block. One patient's block is restored only when this provider asks for
// it, and "Start a new patient" clears the page without losing what was there a second ago.
let stash = "";
function offer(text) {
  dom.restoreText.textContent = text;
  dom.restoreOffer.hidden = text === "";
}
function hideOffer() {
  dom.restoreOffer.hidden = true;
}

dom.block.addEventListener("input", () => {
  hideOffer();
  lastEdit = null;
  render();
});
dom.undo.addEventListener("click", undoLastEdit);
dom.ack.addEventListener("change", () => {
  acknowledged = dom.ack.checked ? dom.ack.dataset.signature ?? null : null;
  render();
});
dom.newPatient.addEventListener("click", () => {
  stash = dom.block.value;
  dom.block.value = "";
  acknowledged = null;
  render();
  offer("Cleared. The block that was here is still in this tab's memory until you paste the next one.");
  dom.block.focus();
});
dom.restore.addEventListener("click", () => {
  dom.block.value = stash;
  hideOffer();
  render();
});
dom.discard.addEventListener("click", () => {
  stash = "";
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Nothing to remove when storage is unavailable.
  }
  hideOffer();
  dom.block.focus();
});
dom.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(dom.link.textContent);
    dom.linkState.textContent = "Copied. Paste it into the patient's message.";
    dom.linkState.className = "provider__link-state is-done";
  } catch {
    dom.linkState.textContent = "This browser blocked copying. Select the link and copy it.";
    dom.linkState.className = "provider__link-state is-blocked";
  }
});
try {
  stash = sessionStorage.getItem(STORE_KEY) ?? "";
} catch {
  // Starts empty when storage is unavailable.
}
render();
if (stash) offer("A block was pasted in this tab earlier. It may be a different patient's.");
