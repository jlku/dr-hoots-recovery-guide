// Runs the dot-phrase edit eval (qa/dot-phrase/cases.json) against the running build. For each case it
// pastes the edited block into the provider page, opens the patient link it produces, and scores:
//   effective  the guide reflects the edit
//   honest     when it does not, the provider page names that line as not reaching the patient
//   safe       the guide never tells the patient the opposite of what the provider wrote; a link the
//              page withholds until the provider chooses reaches no patient, so it is safe
// Chrome has to run outside a command sandbox.
//   node scripts/eval-dot-phrase.mjs [--out artifacts/dot-phrase-eval] [--case <id>]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import { serveBuild } from "./lib/serve-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flag = (name) => (process.argv.indexOf(name) > 0 ? process.argv[process.argv.indexOf(name) + 1] : null);
const out = resolve(root, flag("--out") ?? "artifacts/dot-phrase-eval");
const suite = JSON.parse(await readFile(join(root, "qa/dot-phrase/cases.json"), "utf8"));
const cases = suite.cases.filter((item) => !flag("--case") || item.id === flag("--case"));

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (haystack, needle) => new RegExp(`(^|\\W)${escape(needle)}(\\W|$)`, "i").test(haystack);

function blockFor(item, base = suite.base_block) {
  const lines = base.map((line) => {
    const key = Object.keys(item.replace ?? {}).find((prefix) => line.startsWith(prefix));
    return key ? item.replace[key] : line;
  });
  return [...lines, ...(item.add ?? [])].join("\n");
}

function check(spec = {}, { guide, page, link }) {
  const misses = [];
  for (const text of spec.contains ?? []) if (!has(guide, text)) misses.push(`guide does not say "${text}"`);
  for (const text of spec.lacks ?? []) if (has(guide, text)) misses.push(`guide still says "${text}"`);
  for (const text of spec.page_mentions ?? []) if (!page.includes(text)) misses.push(`provider page does not show "${text}"`);
  for (const [key, value] of Object.entries(spec.link ?? {})) if (link[key] !== value) misses.push(`link ${key}=${link[key] ?? "(none)"}, wanted ${value}`);
  return misses;
}

async function runCase(browser, base, item) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/guide/provider.html`);
  await page.waitForSelector("#parsed tbody tr");
  await page.fill("#block", blockFor(item));
  await page.waitForTimeout(200);
  const provider = await page.evaluate(() => ({
    text: document.querySelector(".provider__result")?.innerText ?? "",
    rows: [...document.querySelectorAll("#parsed tbody tr")].map((row) => [...row.children].map((cell) => cell.textContent.trim())),
    notInGuide: [...document.querySelectorAll("#unread li, [data-not-in-guide] li, li[data-not-in-guide], p[data-not-in-guide], tr.needs-choice")].map((node) => node.textContent),
    other: document.getElementById("other")?.textContent ?? "",
    link: document.getElementById("patient-link")?.textContent ?? ""
  }));
  await page.screenshot({ path: join(out, `${item.id}-provider.png`), fullPage: true });
  const withheld = !provider.link;
  let guide = "";
  if (!withheld) {
    await page.goto(provider.link.replace(/^https?:\/\/[^/]+/, base));
    await page.waitForSelector("body[data-ready]", { state: "attached", timeout: 15000 });
    await page.waitForTimeout(300);
    guide = await page.evaluate(() => document.body.innerText);
  }
  await context.close();
  const link = withheld ? {} : Object.fromEntries(new URLSearchParams(new URL(provider.link).hash.slice(1)));
  const evidence = { guide, page: provider.text, link };
  const effectiveMisses = check(withheld ? { page_mentions: item.effective?.page_mentions } : item.effective, evidence);
  if (withheld && (item.effective?.contains || item.effective?.link)) effectiveMisses.push("the page withholds the link until the provider chooses");
  const safeMisses = withheld ? [] : check(item.safe, evidence);
  const named = provider.notInGuide.some((line) => line.includes(item.line));
  return {
    id: item.id,
    kind: item.kind,
    intent: item.intent,
    withheld,
    effective: effectiveMisses.length === 0,
    honest: effectiveMisses.length === 0 || named,
    safe: safeMisses.length === 0,
    misses: [...effectiveMisses, ...safeMisses.filter((miss) => !effectiveMisses.includes(miss))],
    provider: { rows: provider.rows, not_in_guide: provider.notInGuide, other: provider.other, link: provider.link }
  };
}

await mkdir(out, { recursive: true });
const server = await serveBuild(root, "/guide/provider.html");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const item of cases) results.push(await runCase(browser, server.base, item));
} finally {
  await browser.close();
  server.stop();
}
const mark = (ok) => (ok ? "pass" : "FAIL");
const rows = results.map((result) => `| ${result.id} | ${result.kind} | ${mark(result.effective)} | ${mark(result.honest)} | ${mark(result.safe)} | ${result.misses.join("; ").replace(/\|/g, "/")} |`);
const count = (key) => results.filter((result) => result[key]).length;
const summary = `effective ${count("effective")}/${results.length}, honest ${count("honest")}/${results.length}, safe ${count("safe")}/${results.length}`;
const report = [`# Dot-phrase edit eval`, "", summary, "", "| Case | Kind | Effective | Honest | Safe | What went wrong |", "| --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
await writeFile(join(out, "results.json"), `${JSON.stringify({ summary, results }, null, 2)}\n`);
await writeFile(join(out, "report.md"), report);
for (const result of results) console.log(`${mark(result.effective).padEnd(4)} ${mark(result.honest).padEnd(4)} ${mark(result.safe).padEnd(4)} ${result.id}${result.misses.length ? `: ${result.misses.join("; ")}` : ""}`);
console.log(`\n${summary}\n${join(out, "report.md")}`);
