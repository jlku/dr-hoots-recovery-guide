// Exports every fixed segment in every narrated language as a verified 1080x1920 MP4:
//   node scripts/export-segments.mjs [--out artifacts/v2-export] [--language en] [--segment 1]
// Pictures are static, so each video is a sequence of stills captured from guide/export.html at the
// moments a beat, caption, or spoken word starts. ffmpeg joins them with their exact durations and the
// segment's narration; ffprobe checks the result. Chrome has to run outside a command sandbox.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright-core";

import { fixedSegments } from "../guide/assets/logic.js";
import { buildHash } from "./lib/build-hash.mjs";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flag = (name) => (process.argv.indexOf(name) > 0 ? process.argv[process.argv.indexOf(name) + 1] : null);
const out = resolve(root, flag("--out") ?? "artifacts/v2-export");
const ARTIFACT = "ci-phase0-v0.1.0";
const FPS = 30;
const TOLERANCE_SECONDS = 0.15;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/serve.mjs"], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await fetch(`${base}/guide/export.html`).then((response) => response.ok, () => false)) return { base, stop: () => child.kill() };
    await new Promise((wait) => setTimeout(wait, 100));
  }
  child.kill();
  throw new Error("the static server did not start");
}

async function probe(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", file]);
  const info = JSON.parse(stdout);
  const video = info.streams.find((stream) => stream.codec_type === "video");
  const audio = info.streams.find((stream) => stream.codec_type === "audio");
  return { width: video?.width, height: video?.height, video: video?.codec_name, audio: audio?.codec_name, duration: Number(info.format.duration) };
}

async function exportOne(browser, base, { number, language }) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/guide/export.html?segment=${number}&lang=${language}`);
  const info = await page.evaluate(() => window.exportReady);
  const work = join(out, ".stills", language, info.slug);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const stills = [];
  for (const [index, at] of info.points.entries()) {
    const state = await page.evaluate((seconds) => window.renderAt(seconds), at);
    if (state.overflow) throw new Error(`segment ${number} ${language}: the caption at ${at}s does not fit two lines`);
    const file = join(work, `${String(index).padStart(4, "0")}.png`);
    await page.screenshot({ path: file });
    const until = info.points[index + 1] ?? info.duration;
    stills.push({ file, seconds: until - at });
  }
  await page.close();
  if (errors.length) throw new Error(`segment ${number} ${language}: ${errors.join("; ")}`);
  // The concat demuxer takes each still's duration and needs the last still listed once more.
  const list = [...stills.map((still) => `file '${still.file}'\nduration ${still.seconds.toFixed(3)}`), `file '${stills.at(-1).file}'`].join("\n");
  const listFile = join(work, "stills.txt");
  await writeFile(listFile, `${list}\n`);
  const target = join(out, language, `${info.slug}.mp4`);
  await mkdir(dirname(target), { recursive: true });
  await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-i", join(root, info.audio), "-map", "0:v", "-map", "1:a", "-vf", `fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-t", String(info.duration), "-movflags", "+faststart", target]);
  const probed = await probe(target);
  const problems = [];
  if (probed.width !== 1080 || probed.height !== 1920) problems.push(`size ${probed.width}x${probed.height}`);
  if (probed.video !== "h264" || probed.audio !== "aac") problems.push(`codecs ${probed.video}/${probed.audio}`);
  if (Math.abs(probed.duration - info.duration) > TOLERANCE_SECONDS) problems.push(`duration ${probed.duration.toFixed(2)}s against ${info.duration}s`);
  if (problems.length) throw new Error(`${relative(root, target)}: ${problems.join(", ")}`);
  return { segment: number, language, file: relative(out, target), seconds: Number(probed.duration.toFixed(2)), timeline_seconds: info.duration, stills: stills.length, sha256: sha256(await readFile(target)) };
}

const started = Date.now();
const { segments } = await readJson(`content/segments/${ARTIFACT}.segments.json`);
const index = await readJson("assets/captions/v2/index.json");
const onlyLanguage = flag("--language");
const onlySegment = flag("--segment") ? Number(flag("--segment")) : null;
const jobs = [];
for (const segment of fixedSegments(segments)) {
  if (onlySegment && segment.number !== onlySegment) continue;
  for (const language of [...new Set(index.entries.filter((entry) => entry.number === segment.number).map((entry) => entry.language))]) {
    if (onlyLanguage && language !== onlyLanguage) continue;
    jobs.push({ number: segment.number, language });
  }
}
if (!jobs.length) throw new Error("nothing to export for that segment and language");
const server = await startServer();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const files = [];
try {
  for (const job of jobs) {
    const result = await exportOne(browser, server.base, job);
    files.push(result);
    console.log(`${result.file}: ${result.seconds}s, ${result.stills} stills`);
  }
} finally {
  await browser.close();
  server.stop();
}
await rm(join(out, ".stills"), { recursive: true, force: true });
const manifest = { schema_version: "1.0", patient_use: false, exported_on: new Date().toISOString().slice(0, 10), build: await buildHash(root), canvas: { width: 1080, height: 1920, fps: FPS }, files };
await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${join(relative(root, out) || ".", "manifest.json")}: ${files.length} files verified in ${((Date.now() - started) / 1000).toFixed(1)}s`);
