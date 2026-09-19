// guide/assets/provider-page.js
// The provider page: paste the dot-phrase block, see what the guide will use, copy the patient link.
// The presets are the only thing it loads; parsing and the link happen in the page.
import { fetchJson } from "./data.js";
import { LANGUAGES } from "./logic.js";
import { applyPresets, buildPatientLink, parseProviderBlock } from "./provider.js";

const byId = (id) => document.getElementById(id);
const dom = { block: byId("block"), parsed: byId("parsed").querySelector("tbody"), other: byId("other"), unreadBlock: byId("unread-block"), unread: byId("unread"), link: byId("patient-link"), copy: byId("copy-link") };
const { presets } = await fetchJson("content/provider/presets.json");
const languageName = (code) => LANGUAGES.find((language) => language.code === code)?.label ?? code;
const yesNo = (value) => (value ? "Yes" : "No");

function row(field, value, source) {
  const tr = document.createElement("tr");
  for (const [index, text] of [field, value, source].entries()) {
    const cell = document.createElement(index === 0 ? "th" : "td");
    if (index === 0) cell.scope = "row";
    cell.textContent = text;
    tr.append(cell);
  }
  if (source === "preset") tr.classList.add("is-preset");
  return tr;
}

function render() {
  const parsed = parseProviderBlock(dom.block.value);
  const { values, from_presets: fromPresets } = applyPresets(parsed.fields, presets);
  const source = (key) => (fromPresets.includes(key) ? "preset" : "your block");
  dom.parsed.replaceChildren(
    row("Antibiotic", yesNo(values.antibiotic), source("antibiotic")),
    row("Pain medication", yesNo(values.pain_medication), source("pain_medication")),
    row("Follow-up", values.follow_up_date ?? "about two weeks after surgery", source("follow_up_date")),
    row("Language", languageName(values.language), source("language")),
    row("Reviewed by", values.reviewed ? `${values.reviewed.by}, ${values.reviewed.date}` : "not recorded", values.reviewed ? "your block" : "none")
  );
  dom.other.textContent = parsed.other ? `${parsed.other} other ${parsed.other === 1 ? "line stays" : "lines stay"} in your note and do not change the guide.` : "";
  dom.unread.replaceChildren(...parsed.unread.map((line) => Object.assign(document.createElement("li"), { textContent: line })));
  dom.unreadBlock.hidden = parsed.unread.length === 0;
  dom.link.textContent = buildPatientLink(values, new URL("index.html", location.href).href);
}

dom.block.addEventListener("input", render);
dom.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(dom.link.textContent);
    dom.copy.textContent = "Copied";
  } catch {
    dom.copy.textContent = "Select the link to copy it";
  }
  setTimeout(() => (dom.copy.textContent = "Copy link"), 2000);
});
render();
