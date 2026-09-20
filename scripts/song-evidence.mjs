// Captures what the simulated Song reviewer judges: facts code can measure from the running build, and
// screenshots at desktop and phone widths. Drives the installed Google Chrome through playwright-core;
// Chrome has to run outside a command sandbox.
//   node scripts/song-evidence.mjs --out <directory outside the repository>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import { buildFiles, buildHash } from "./lib/build-hash.mjs";
import { serveBuild } from "./lib/serve-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outIndex = process.argv.indexOf("--out");
if (outIndex < 0) throw new Error("usage: node scripts/song-evidence.mjs --out <directory>");
const out = resolve(process.argv[outIndex + 1]);
if (out.startsWith(`${root}/`)) throw new Error("write evidence outside the repository, so it never enters the build it describes");

const ARTIFACT = "ci-phase0-v0.1.0";
const LANGUAGES = ["en", "es", "zh-Hans"];
const CEILING_SECONDS = 35;
const CARD = "output/pdf/airline-safety-card-deck-prototype.pdf";
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
// A filled-in example of the block, so the evidence shows the provider's overrides. The reviewer name
// is a placeholder; only the date reaches the link.
const FILLED_BLOCK = [
  "Antibiotic: No",
  "Pain medication: Yes",
  "Follow-up: wound check and ear exam on 10/01/2026",
  "Video guide: language Spanish    Reviewed by Dr. Example on 2026-09-19"
].join("\n");

const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const exists = (path) => readFile(join(root, path)).then(() => true, () => false);
const normalize = (text) => String(text ?? "").replace(/\s+/g, "");

// Facts from the committed media, before any browser opens.
async function mediaFacts() {
  const index = await readJson("assets/captions/v2/index.json");
  const segments = (await readJson(`content/segments/${ARTIFACT}.segments.json`)).segments;
  const voices = (await readJson("assets/audio/v2/voices.json")).languages;
  const numbers = segments.map((segment) => segment.number);
  const byLanguage = Object.fromEntries(LANGUAGES.map((language) => [language, index.entries.filter((entry) => entry.language === language)]));
  const narrated = LANGUAGES.filter((language) => numbers.every((number) => byLanguage[language].some((entry) => entry.number === number)));
  // The ceiling is on narration, as in the spec and scripts/lib/segments.mjs; the running time adds the
  // title card, the pauses between beats, and the tail.
  const longestOf = (language, number, key) => {
    const values = byLanguage[language].filter((entry) => entry.number === number).map((entry) => entry[key]);
    return values.length ? Math.max(...values) : null;
  };
  const seconds = Object.fromEntries(LANGUAGES.map((language) => [language, Object.fromEntries(numbers.map((number) => [number, longestOf(language, number, "narration_seconds")]))]));
  const running = Object.fromEntries(LANGUAGES.map((language) => [language, Object.fromEntries(numbers.map((number) => [number, longestOf(language, number, "duration_seconds")]))]));
  const longest = Math.max(...Object.values(seconds).flatMap((row) => Object.values(row).filter((value) => value !== null)));
  const captions = {};
  for (const language of LANGUAGES) {
    captions[language] = [];
    for (const number of numbers) {
      const entries = byLanguage[language].filter((entry) => entry.number === number);
      if (entries.length && (await Promise.all(entries.map((entry) => exists(entry.captions)))).every(Boolean)) captions[language].push(number);
    }
  }
  const owl = [];
  const patientFacing = (await buildFiles(root)).filter((path) => /^(guide\/|content\/(translations|frames|segments)\/|assets\/anatomy\/manifest\.json)/.test(path) && /\.(html|js|css|json)$/.test(path));
  for (const path of patientFacing) {
    (await readFile(join(root, path), "utf8")).split("\n").forEach((line, number) => {
      if (/\bowls?\b|hoots/i.test(line)) owl.push({ file: path, line: number + 1 });
    });
  }
  return {
    segments: numbers,
    short_clips: { ok: narrated.includes("en") && longest <= CEILING_SECONDS && narrated.every((language) => numbers.every((number) => seconds[language][number] !== null)), ceiling_seconds: CEILING_SECONDS, longest_narration_seconds: longest, narration_seconds_by_language: seconds, running_seconds_by_language: running, narrated_languages: narrated },
    no_owl: { ok: owl.length === 0, files_searched: patientFacing.length, matches: owl },
    narrator: {
      ok: LANGUAGES.every((language) => voices[language]?.voice && narrated.includes(language)),
      voices: Object.fromEntries(LANGUAGES.map((language) => [language, voices[language]?.voice ?? null])),
      narrated_languages: narrated
    },
    subtitles: { ok: LANGUAGES.every((language) => captions[language].length === numbers.length), segments_with_captions: captions },
    index
  };
}

async function openGuide(context, base, fragment) {
  const page = await context.newPage();
  await page.goto(`${base}/guide/index.html#${fragment}`);
  await page.waitForSelector("body[data-ready]", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(300);
  return page;
}

async function tocFacts(browser, base, index, numbers) {
  const context = await browser.newContext(DESKTOP);
  const page = await openGuide(context, base, "s=1&l=en");
  const presets = (await readJson("content/provider/presets.json")).presets;
  const variant = `a${presets.antibiotic ? 1 : 0}p${presets.pain_medication ? 1 : 0}`;
  const duration = (number) => index.entries.find((entry) => entry.language === "en" && entry.number === number && (!entry.variant || entry.variant === variant))?.duration_seconds ?? 0;
  const chapters = [];
  let start = 0;
  for (const number of numbers) {
    await page.click(`#chapter-list .chapter[data-number="${number}"]`);
    await page.waitForTimeout(400);
    const at = Number(await page.inputValue("#scrubber")) / 1000;
    const current = Number(await page.getAttribute("#chapter-list .chapter[aria-current]", "data-number"));
    chapters.push({ number, expected_start: Number(start.toFixed(2)), landed_at: at, active_chapter: current, ok: Math.abs(at - start) <= 0.5 && current === number });
    start += duration(number);
  }
  await context.close();
  const visible = {};
  for (const language of LANGUAGES) {
    const view = await browser.newContext(DESKTOP);
    const guide = await openGuide(view, base, `s=1&l=${language}`);
    visible[language] = await guide.evaluate(() => {
      const list = document.getElementById("chapter-list").getBoundingClientRect();
      return [...document.querySelectorAll("#chapter-list .chapter")].map((button) => {
        const box = button.getBoundingClientRect();
        return box.top >= list.top - 1 && box.bottom <= list.bottom + 1;
      }).every(Boolean);
    });
    await view.close();
  }
  return { ok: chapters.every((chapter) => chapter.ok) && Object.values(visible).every(Boolean), listed: chapters.length, chapters, every_chapter_visible_at_1280x800: visible };
}

async function languageFacts(browser, base) {
  const results = {};
  for (const language of ["es", "zh-Hans"]) {
    const context = await browser.newContext(DESKTOP);
    const page = await openGuide(context, base, "s=1&l=en");
    await page.selectOption("#language", language);
    await page.waitForSelector(`body[data-ready^="${language}:"]`, { state: "attached", timeout: 15000 });
    await page.waitForTimeout(300);
    const pack = await readJson(`content/translations/${language}/${ARTIFACT}.json`);
    const shown = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      title: document.getElementById("guide-title")?.textContent,
      audio: document.getElementById("audio")?.currentSrc || document.getElementById("audio")?.getAttribute("src") || "",
      first_sentence: document.querySelector("#transcript .sentence")?.textContent ?? null,
      status: document.getElementById("status")?.hidden ? "" : document.getElementById("status")?.textContent
    }));
    const audioLanguage = shown.audio.match(/assets\/audio\/v2\/([^/]+)\//)?.[1] ?? null;
    results[language] = {
      ...shown,
      audio_language: audioLanguage,
      expected_first_sentence: pack.sentences["wc.01"],
      ok: shown.lang === language && audioLanguage === language && normalize(shown.first_sentence) === normalize(pack.sentences["wc.01"])
    };
    await context.close();
  }
  return { ok: Object.values(results).every((result) => result.ok), ...results };
}

async function providerFacts(browser, base, out) {
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  await page.goto(`${base}/guide/provider.html`);
  await page.waitForSelector("#parsed tbody tr");
  await page.waitForTimeout(300);
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const table = () => page.$$eval("#parsed tbody tr", (rows) => rows.map((row) => [...row.children].map((cell) => cell.textContent.trim())));
  const draft = await readFile(join(root, "content/provider/dot-phrase-draft.txt"), "utf8");
  await page.fill("#block", draft);
  await page.waitForTimeout(200);
  const draftRows = await table();
  const draftUnread = await page.$$eval("#unread li", (items) => items.map((item) => item.textContent));
  await page.screenshot({ path: join(out, "provider-draft.png") });
  const started = performance.now();
  await page.fill("#block", FILLED_BLOCK);
  await page.waitForFunction(() => document.getElementById("patient-link")?.textContent.includes("f=2026-10-01"));
  const milliseconds = Math.round(performance.now() - started);
  const filledRows = await table();
  const link = await page.textContent("#patient-link");
  await page.screenshot({ path: join(out, "provider-filled.png") });
  const accountFields = await page.$$eval('input[type="password"], input[type="email"], form[action]', (nodes) => nodes.length);
  await context.close();
  const columns = ["Antibiotic", "Pain medication", "Follow-up", "Reviewed by"];
  const hasColumns = (rows) => columns.every((name) => rows.some((row) => row[0] === name && row[1] && row[2]));
  const fragment = new URL(link).hash;
  return {
    link,
    ok: hasColumns(draftRows) && hasColumns(filledRows) && /[#&]a=0/.test(fragment) && /[&]p=1/.test(fragment) && /f=2026-10-01/.test(fragment) && !/[#&]r=/.test(fragment) && milliseconds < 60000 && requests.length === 0 && accountFields === 0,
    steps: ["paste the block", "copy the link"],
    milliseconds_from_paste_to_link: milliseconds,
    requests_after_load: requests,
    account_or_login_fields: accountFields,
    draft_block_rows: draftRows,
    draft_block_unread_lines: draftUnread,
    filled_example_block: FILLED_BLOCK,
    filled_example_rows: filledRows,
    link_fragment: fragment
  };
}

async function reviewLineFacts(browser, base, link, out) {
  const draft = await readFile(join(root, "content/provider/dot-phrase-draft.txt"), "utf8");
  const lines = draft.split("\n").filter((line) => /reviewed by/i.test(line));
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  await page.goto(link.replace(/^https?:\/\/[^/]+/, base));
  await page.waitForSelector("body[data-ready]", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(300);
  const badge = await page.evaluate(() => [...document.querySelectorAll(".badge--clinician")].find((node) => node.offsetParent !== null)?.textContent.trim() ?? null);
  const followUp = await page.evaluate(() => document.querySelector(".transcript__data")?.textContent ?? null);
  await page.evaluate(() => document.querySelector(".transcript__data")?.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: join(out, "guide-from-link.png") });
  await page.evaluate(() => document.querySelector(".transcript-footer")?.scrollIntoView({ block: "end" }));
  await page.screenshot({ path: join(out, "guide-from-link-badges.png") });
  await context.close();
  // John removed the patient-facing review badge: the reviewer stays in the provider's note, so the
  // measured fact is that no badge reaches the patient and no review date rides in the link.
  return { ok: lines.length === 1 && badge === null, lines_in_block: lines, clinician_badge: badge, review_date_in_link: /[#&]r=/.test(link), follow_up_in_transcript: followUp };
}

async function cardFacts(browser, base) {
  const widths = {};
  for (const [name, options] of [["desktop", DESKTOP], ["phone", PHONE]]) {
    const context = await browser.newContext(options);
    const page = await openGuide(context, base, "s=1&l=en");
    // On the first screen without scrolling, and not covered by anything.
    widths[name] = await page.$$eval(`a[href$="${CARD.split("/").pop()}"]`, (links) => links.some((link) => {
      const box = link.getBoundingClientRect();
      if (!box.width || !box.height || link.offsetParent === null) return false;
      if (box.top < 0 || box.bottom > innerHeight || box.left < 0 || box.right > innerWidth) return false;
      return link.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    }));
    await context.close();
  }
  const status = await fetch(`${base}/${CARD}`, { method: "HEAD" }).then((response) => response.status, () => 0);
  return { ok: widths.desktop && widths.phone && status === 200, on_first_screen: widths, card_status: status };
}

async function screenshots(browser, base, out) {
  const shots = [];
  for (const language of LANGUAGES) {
    const names = { en: "English", es: "Spanish", "zh-Hans": "Mandarin" };
    for (const [width, options] of [["desktop", DESKTOP], ["phone", PHONE]]) {
      const context = await browser.newContext(options);
      const page = await openGuide(context, base, `s=1&l=${language}`);
      // Past the title card, so the screenshot shows the chapter's picture and a caption.
      await page.click("#transcript .sentence");
      await page.waitForTimeout(700);
      await page.evaluate(() => document.getElementById("audio").pause());
      await page.waitForTimeout(300);
      const file = `guide-${language}-${width}.png`;
      await page.screenshot({ path: join(out, file) });
      shots.push({ file, shows: `The guide in ${names[language]} at ${width === "desktop" ? "1280 by 800" : "375 by 812 phone"} width, paused on the first sentence of chapter 1, with its picture.` });
      await context.close();
    }
  }
  return shots;
}

await mkdir(out, { recursive: true });
const build = await buildHash(root);
const media = await mediaFacts();
const server = await serveBuild(root);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const toc = await tocFacts(browser, server.base, media.index, media.segments);
  const languages = await languageFacts(browser, server.base);
  const provider = await providerFacts(browser, server.base, out);
  const reviewLine = await reviewLineFacts(browser, server.base, provider.link, out);
  // The link's follow-up date has to reach the patient's reading flow, not only one picture.
  provider.follow_up_in_transcript = reviewLine.follow_up_in_transcript;
  provider.ok = provider.ok && /2026/.test(provider.follow_up_in_transcript ?? "");
  delete reviewLine.follow_up_in_transcript;
  const card = await cardFacts(browser, server.base);
  const shots = [
    ...(await screenshots(browser, server.base, out)),
    { file: "provider-draft.png", shows: "The provider page after pasting the draft dot phrase exactly as written, with its *** placeholders." },
    { file: "provider-filled.png", shows: "The provider page after pasting a filled-in example block: antibiotic no, pain medication yes, a follow-up date, Spanish, and a review line with a placeholder name." },
    { file: "guide-from-link.png", shows: "The guide opened from the filled-in example's patient link, its transcript scrolled to the follow-up date the link carries." },
    { file: "guide-from-link-badges.png", shows: "The same guide, its transcript scrolled to the end, where the review badges are." }
  ];
  const facts = {
    captured_on: new Date().toISOString().slice(0, 10),
    build,
    checks: { short_clips: media.short_clips, no_owl: media.no_owl, narrator: media.narrator, subtitles: media.subtitles, toc, languages, provider_file: provider, review_line: reviewLine, card_summary: card },
    screenshots: shots
  };
  await writeFile(join(out, "facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
  for (const [id, fact] of Object.entries(facts.checks)) console.log(`${fact.ok ? "ok  " : "FAIL"} ${id}`);
  console.log(`${join(out, "facts.json")}: build ${build.sha256.slice(0, 16)}, ${shots.length} screenshots`);
} finally {
  await browser.close();
  server.stop();
}
