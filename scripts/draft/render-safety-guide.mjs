import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { GUIDE_DATA } from "../../preview/assets/guide-data.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = resolve(repositoryRoot, "artifacts/private-export/safety-guide-v1");
const padSeconds = 0.9;
const reuseRaw = process.argv.includes("--reuse-raw");

const sceneDefinitions = [
  { id: "intro", track: "welcome-ci" },
  { id: "part1", silent: 1.6 },
  { id: "s-day2", track: "wound-day2" },
  { id: "s-paths", track: "wound-paths" },
  { id: "s-milestones", track: "wound-milestones" },
  { id: "part2", silent: 1.6 },
  { id: "s-redness", track: "call-three-signs" },
  { id: "s-any", track: "call-any" },
  { id: "s-numbers", track: "call-numbers" },
  { id: "part3", silent: 1.6 },
  { id: "s-healing", track: "healing" },
  { id: "s-programming", track: "chaptered-programming" },
  { id: "s-followup", track: "follow-up" },
  { id: "closing", track: "outro-v2" }
];

const scenes = sceneDefinitions.map((scene) => {
  if (scene.track) {
    const track = GUIDE_DATA.tracks[scene.track];
    if (!track) throw new Error(`missing guide track: ${scene.track}`);
    return { ...scene, duration: track.duration + padSeconds, file: resolve(repositoryRoot, track.file) };
  }
  return { ...scene, duration: scene.silent };
});
const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"]
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function captureHtml() {
  return `<!doctype html>
<html lang="en" data-capture-ready="false">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#000}
.export-label{height:36px;padding:7px 18px;background:#feb80a;color:#052049;font:700 15px/22px "Helvetica Neue",Arial,sans-serif;letter-spacing:.01em}
#source{display:block;width:100%;height:684px;border:0;background:#fff}
#gate{position:fixed;inset:0;z-index:999999;background:#000}
</style>
</head>
<body>
<div class="export-label">PRIVATE REVIEW EXPORT · CLINICAL REVIEW BYPASSED · NOT FOR PATIENT USE</div>
<iframe id="source" title="Private safety guide export" src="about:blank"></iframe>
<div id="gate" aria-hidden="true"></div>
<script>
const frame=document.querySelector('#source');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
window.addEventListener('load',()=>setTimeout(()=>{frame.src='/preview/animatic-video.html';},0),{once:true});
frame.addEventListener('load',async()=>{
  if(frame.contentWindow.location.href==='about:blank')return;
  const win=frame.contentWindow;
  const doc=frame.contentDocument;
  for(let attempt=0;attempt<400&&!win.__animatic;attempt+=1)await sleep(25);
  if(!win.__animatic){document.documentElement.dataset.captureError='renderer_not_ready';return;}
  await doc.fonts.ready;
  await Promise.race([
    Promise.all([...doc.images].map(image=>image.complete?Promise.resolve():image.decode().catch(()=>{}))),
    sleep(3000)
  ]);
  const style=doc.createElement('style');
  style.textContent='html,body{width:1280px!important;height:684px!important;margin:0!important;overflow:hidden!important;background:#fff!important}.draft-notice,.brand-rule,.masthead,.board,footer,noscript{display:none!important}main,.watch-wrap{width:1280px!important;height:684px!important;margin:0!important;padding:0!important}.watch-layout{width:1280px!important;height:684px!important;min-height:684px!important;max-height:none!important;border:0!important}';
  doc.head.append(style);
  win.__animatic.seek(0);
  win.__animatic.pause();
  await sleep(150);
  window.__captureContract={
    total:win.__animatic.TOTAL,
    scenes:win.__animatic.SCENES.map(scene=>({id:scene.id,duration:scene.dur}))
  };
  document.documentElement.dataset.captureReady='true';
});
window.beginCapture=()=>{
  if(document.documentElement.dataset.captureReady!=='true')throw new Error('capture_not_ready');
  document.querySelector('#gate').remove();
  frame.contentWindow.__animatic.play();
  return window.__captureContract;
};
</script>
</body>
</html>`;
}

async function createCaptureServer() {
  const server = createServer(async (request, response) => {
    const parsed = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    if (parsed.pathname === "/capture.html") {
      const html = captureHtml();
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(html),
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(request.method === "HEAD" ? undefined : html);
      return;
    }
    try {
      const path = resolve(repositoryRoot, `.${decodeURIComponent(parsed.pathname)}`);
      if (!path.startsWith(`${repositoryRoot}${sep}`)) throw new Error("path escaped repository root");
      const metadata = await stat(path);
      if (!metadata.isFile()) throw new Error("not a file");
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": metadata.size,
        "Content-Type": mimeTypes.get(extname(path)) ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff"
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const { port } = server.address();
  return {
    port,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
  };
}

async function run(command, args, options = {}) {
  return execFile(command, args, { cwd: repositoryRoot, maxBuffer: 16 * 1024 * 1024, ...options });
}

async function buildRadioCut() {
  const segmentRoot = join(outputRoot, "audio-segments");
  await mkdir(segmentRoot, { recursive: true });
  const segmentPaths = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const path = join(segmentRoot, `${String(index + 1).padStart(2, "0")}-${scene.id}.wav`);
    if (scene.track) {
      await run("ffmpeg", [
        "-v", "error", "-nostdin", "-y", "-i", scene.file,
        "-af", `apad=pad_dur=${padSeconds}`,
        "-t", scene.duration.toFixed(6), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", path
      ]);
    } else {
      await run("ffmpeg", [
        "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-t", scene.duration.toFixed(6), "-c:a", "pcm_s16le", path
      ]);
    }
    segmentPaths.push(path);
  }
  const concatPath = join(outputRoot, "audio-concat.txt");
  const concat = segmentPaths.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n");
  await writeFile(concatPath, `${concat}\n`, { mode: 0o600 });
  const radioPath = join(outputRoot, "safety-guide-radio.m4a");
  await run("ffmpeg", [
    "-v", "error", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
    "-t", totalDuration.toFixed(6), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", radioPath
  ]);
  return radioPath;
}

async function detectInitialBlack(path) {
  try {
    const { stderr } = await run("ffmpeg", [
      "-hide_banner", "-nostdin", "-i", path,
      "-vf", "blackdetect=d=0.04:pix_th=0.02", "-an", "-f", "null", "-"
    ]);
    const matches = [...`${stderr ?? ""}`.matchAll(/black_end:([0-9.]+)/g)];
    return matches.length ? Number(matches[0][1]) : 0;
  } catch (error) {
    const matches = [...`${error.stderr ?? ""}`.matchAll(/black_end:([0-9.]+)/g)];
    return matches.length ? Number(matches[0][1]) : 0;
  }
}

async function captureVisual() {
  const rawPath = join(outputRoot, "safety-guide-raw.webm");
  const visualPath = join(outputRoot, "safety-guide-visual.mp4");
  const expectedContract = {
    total: totalDuration,
    scenes: scenes.map((scene) => ({ id: scene.id, duration: scene.duration }))
  };
  if (reuseRaw) {
    await stat(rawPath);
    const trimStart = await detectInitialBlack(rawPath);
    await run("ffmpeg", [
      "-v", "error", "-nostdin", "-y", "-i", rawPath,
      "-vf", `trim=start=${trimStart.toFixed(6)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1,fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`,
      "-t", totalDuration.toFixed(6), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", visualPath
    ]);
    return { visualPath, rawPath, contract: expectedContract, trimStart, console: "recovered from completed raw capture" };
  }
  const session = `safety-guide-export-${process.pid}`;
  const server = await createCaptureServer();
  await rm(rawPath, { force: true });
  try {
    await run("agent-browser", ["--session", session, "set", "viewport", "1280", "720"]);
    await run("agent-browser", ["--session", session, "record", "start", rawPath, `http://127.0.0.1:${server.port}/capture.html`]);
    let ready = false;
    let readyError;
    for (let attempt = 0; attempt < 4 && !ready; attempt += 1) {
      try {
        await run("agent-browser", ["--session", session, "wait", "html[data-capture-ready=\"true\"]"]);
        ready = true;
      } catch (error) {
        readyError = error;
      }
    }
    if (!ready) {
      const { stdout: state } = await run("agent-browser", [
        "--session", session, "eval",
        "JSON.stringify({dataset:{...document.documentElement.dataset},frameUrl:document.querySelector('#source')?.contentWindow?.location?.href,frameReady:Boolean(document.querySelector('#source')?.contentWindow?.__animatic)})"
      ]).catch(() => ({ stdout: "unavailable" }));
      throw new Error(`capture renderer did not become ready: ${state.trim()} | ${readyError?.message ?? "unknown"}`);
    }
    const { stdout } = await run("agent-browser", ["--session", session, "eval", "JSON.stringify(window.beginCapture())"]);
    const contractText = stdout.trim().replace(/^"|"$/g, "").replaceAll('\\"', '"');
    const contract = JSON.parse(contractText);
    if (Math.abs(contract.total - totalDuration) > 0.02) {
      throw new Error(`browser timeline ${contract.total} does not match export timeline ${totalDuration}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.ceil((totalDuration + 1.2) * 1000)));
    const [{ stdout: consoleOutput }, { stdout: errorOutput }] = await Promise.all([
      run("agent-browser", ["--session", session, "console"]),
      run("agent-browser", ["--session", session, "errors"])
    ]);
    await run("agent-browser", ["--session", session, "record", "stop"]);
    if (errorOutput.trim()) throw new Error(`browser errors during capture: ${errorOutput.trim()}`);
    const trimStart = await detectInitialBlack(rawPath);
    await run("ffmpeg", [
      "-v", "error", "-nostdin", "-y", "-i", rawPath,
      "-vf", `trim=start=${trimStart.toFixed(6)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1,fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`,
      "-t", totalDuration.toFixed(6), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", visualPath
    ]);
    return { visualPath, rawPath, contract, trimStart, console: consoleOutput.trim() };
  } finally {
    await run("agent-browser", ["--session", session, "close"]).catch(() => {});
    await server.close();
  }
}

async function probe(path) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate",
    "-of", "json", path
  ]);
  return JSON.parse(stdout);
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  const [radioPath, capture] = await Promise.all([buildRadioCut(), captureVisual()]);
  const masterPath = join(outputRoot, "safety-guide-private-review.mp4");
  await run("ffmpeg", [
    "-v", "error", "-nostdin", "-y", "-i", capture.visualPath, "-i", radioPath,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy",
    "-t", totalDuration.toFixed(6), "-movflags", "+faststart", masterPath
  ]);

  const posterPath = join(outputRoot, "poster.png");
  const contactSheetPath = join(outputRoot, "contact-sheet.png");
  await run("ffmpeg", ["-v", "error", "-nostdin", "-y", "-ss", "1.0", "-i", masterPath, "-frames:v", "1", posterPath]);
  const sampleTimes = [0.5, totalDuration * 0.25, totalDuration * 0.5, totalDuration * 0.75, totalDuration - 0.5];
  const select = sampleTimes.map((seconds) => `eq(n\\,${Math.round(seconds * 30)})`).join("+");
  await run("ffmpeg", [
    "-v", "error", "-nostdin", "-y", "-i", masterPath,
    "-vf", `select='${select}',scale=256:144,tile=5x1`, "-frames:v", "1", "-vsync", "vfr", contactSheetPath
  ]);

  const [masterBytes, radioBytes, visualBytes] = await Promise.all([
    readFile(masterPath), readFile(radioPath), readFile(capture.visualPath)
  ]);
  const manifest = {
    schema_version: "safety-guide-private-export/v1",
    created_at: new Date().toISOString(),
    source_page: "preview/animatic-video.html",
    duration_seconds: totalDuration,
    canvas: { width: 1280, height: 720, fps: 30 },
    clinical_review_bypassed_for_private_export: true,
    clinical_approval: false,
    patient_ready: false,
    private_review_only: true,
    files: {
      master: { path: masterPath.slice(repositoryRoot.length + 1), sha256: sha256(masterBytes) },
      radio: { path: radioPath.slice(repositoryRoot.length + 1), sha256: sha256(radioBytes) },
      visual: { path: capture.visualPath.slice(repositoryRoot.length + 1), sha256: sha256(visualBytes) },
      poster: { path: posterPath.slice(repositoryRoot.length + 1) },
      contact_sheet: { path: contactSheetPath.slice(repositoryRoot.length + 1) }
    },
    capture: { trim_start_seconds: capture.trimStart, browser_contract: capture.contract, console: capture.console },
    ffprobe: await probe(masterPath)
  };
  const manifestPath = join(outputRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ master: masterPath, poster: posterPath, contact_sheet: contactSheetPath, manifest: manifestPath, duration_seconds: totalDuration }, null, 2)}\n`);
}

await main();
