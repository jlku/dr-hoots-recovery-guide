import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import { platform, arch, release } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  authorizeCaptureRequest,
  buildAnimaticComparisonManifest,
  sha256,
  validateAnimaticComparisonManifest
} from "./lib/activation-animatics.mjs";
import {
  buildActivationComparisonModel,
  validateActivationComparisonModel
} from "./lib/activation-production.mjs";
import {
  addArtifact,
  addPacket,
  createArtifactRecord,
  createPacketRecord,
  persistRunRevision,
  validateRunState
} from "./lib/production-run.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;
const REVISION_ID_PATTERN = /^revision:[a-f0-9]{64}$/;
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".mp3", "audio/mpeg"]
]);
const ALLOWED_CAPTURE_PATHS = new Set([
  "/capture.html",
  "/variations.html",
  "/assets/safety-card.css",
  "/assets/variations.css",
  "/assets/safety-card.js",
  "/assets/variations.js",
  "/assets/audio/manifest.json",
  "/assets/audio/healing.mp3",
  "/assets/audio/chaptered-programming.mp3",
  "/assets/audio/follow-up.mp3",
  "/assets/character/dr-hoots-motion-base-v2.png",
  "/assets/character/dr-hoots-wing-rig-v2.png",
  "/assets/illustrations/manifest.json",
  "/assets/illustrations/ci-activation-programming-safety-card-v1.png",
  "/content/canonical/ci-phase0-v0.1.0.json",
  "/content/scenes/ci-phase0-v0.1.0.scenes.json",
  "/content/adaptations/activation-programming-v0.1.0.json",
  "/content/productions/ci-activation-v0.1.0.json",
  "/scripts/lib/activation-production.mjs"
]);

function parseArguments(argv) {
  const options = {
    stateRoot: resolve(repositoryRoot, ".production/activation"),
    runId: null,
    json: false,
    skipCapture: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--run-id") {
      options.runId = argv[index + 1];
      index += 1;
    } else if (argument === "--state-root") {
      options.stateRoot = resolve(argv[index + 1]);
      index += 1;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--skip-capture") {
      options.skipCapture = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!RUN_ID_PATTERN.test(options.runId ?? "")) throw new Error("--run-id is required and must be valid");
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function hashFile(path) {
  return sha256(await readFile(path));
}

async function fileRecord(path) {
  const [contents, metadata] = await Promise.all([readFile(path), stat(path)]);
  return { sha256: sha256(contents), byte_length: metadata.size };
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function loadCurrentRun(stateRoot, runId) {
  const runRoot = join(stateRoot, "runs", runId);
  const pointer = await readJson(join(runRoot, "current.json"));
  if (pointer.run_id !== runId || !REVISION_ID_PATTERN.test(pointer.revision_id ?? "")) {
    throw new Error("run pointer is invalid");
  }
  const run = await readJson(join(runRoot, "revisions", `${pointer.revision_id.slice(9)}.json`));
  validateRunState(run);
  if (run.stage !== "animatic_review" || run.status !== "pending_review") {
    throw new Error(`animatics require animatic_review/pending_review, not ${run.stage}/${run.status}`);
  }
  return { run, pointer, runRoot };
}

async function resolveRadioBundle(runRoot, run) {
  const radioManifestArtifact = run.artifacts.find(
    (artifact) => artifact.kind === "activation_radio_manifest" &&
      artifact.content_lock_id === run.current_content_lock_id
  );
  if (!radioManifestArtifact) throw new Error("current radio manifest artifact is missing");
  const manifestPath = join(runRoot, radioManifestArtifact.file_path);
  const manifest = await readJson(manifestPath);
  const directory = dirname(manifestPath);
  const timeline = await readJson(join(directory, "timeline.json"));
  const storyboard = await readJson(join(directory, "storyboard.json"));
  const wordTimings = await readJson(join(directory, "word-timings.json"));
  if (manifest.content_lock_id !== run.current_content_lock_id) {
    throw new Error("radio bundle is stale for the current content lock");
  }
  return { manifest, timeline, storyboard, wordTimings, directory, radioManifestArtifact };
}

async function buildRendererModels() {
  const [production, canonical, adaptation, narration, illustrationManifest] = await Promise.all([
    readJson(join(repositoryRoot, "content/productions/ci-activation-v0.1.0.json")),
    readJson(join(repositoryRoot, "content/canonical/ci-phase0-v0.1.0.json")),
    readJson(join(repositoryRoot, "content/adaptations/activation-programming-v0.1.0.json")),
    readJson(join(repositoryRoot, "assets/audio/manifest.json")),
    readJson(join(repositoryRoot, "assets/illustrations/manifest.json"))
  ]);
  const activation = canonical.modules.find((module) => module.id === "ci/activation");
  const sentences = new Map(activation.canonical_sentences.map((sentence) => [sentence.id, sentence]));
  const records = new Map(narration.records.map((record) => [record.id, record]));
  const illustration = illustrationManifest.assets.find(
    (asset) => asset.scene_id === "scene/activation/programming" && asset.renderable_in_private_prototype
  );
  const sceneInputs = production.scenes.map((scene) => {
    const record = records.get(scene.narration_id);
    if (!record) throw new Error(`${scene.narration_id}: narration record is missing`);
    const text = scene.scene_id === "scene/activation/programming"
      ? adaptation.formats.chaptered_video.blocks.map((block) => block.text).join(" ")
      : scene.canonical_sentence_ids.map((id) => sentences.get(id)?.text).join(" ");
    return {
      scene_id: scene.scene_id,
      label: scene.scene_id === "scene/activation/healing"
        ? "After healing"
        : scene.scene_id === "scene/activation/programming"
          ? adaptation.formats.chaptered_video.scene_title
          : "Follow-up visits",
      text,
      timing: {
        narration_id: scene.narration_id,
        duration_seconds: Math.max(...record.timestamps.flatMap((chunk) => chunk.character_end_times_seconds))
      },
      illustration: scene.illustration_file
        ? { file: scene.illustration_file, alt: illustration.alt }
        : null
    };
  });
  const baseline = buildActivationComparisonModel({ production, scenes: sceneInputs, variant: "baseline" });
  const mixed = buildActivationComparisonModel({ production, scenes: sceneInputs, variant: "mixed" });
  validateActivationComparisonModel(baseline);
  validateActivationComparisonModel(mixed);
  return { baseline, mixed };
}

async function commandVersion(command, args = ["--version"]) {
  const { stdout, stderr } = await execFile(command, args, { cwd: repositoryRoot });
  return `${stdout}${stderr}`.trim().split("\n")[0];
}

function captureWrapperHtml(searchParams, timeline) {
  const variant = searchParams.get("variant");
  const scene = Number(searchParams.get("scene"));
  if (!new Set(["baseline", "mixed"]).has(variant) || !Number.isInteger(scene) || scene < 0 || scene > 2) {
    return null;
  }
  const source = `/variations.html?mode=watch&embed=1&comparison=${variant}&media=animatic`;
  const captureClock = JSON.stringify({
    total_duration_seconds: timeline.total_duration_seconds,
    scenes: timeline.scenes.map((entry) => ({
      global_start_seconds: entry.global_start_seconds,
      duration_seconds: entry.duration_seconds
    }))
  });
  return `<!doctype html>
<html lang="en" data-capture-ready="false" data-capture-started="false">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#000}
#source{width:100%;height:100%;display:block;border:0;background:#fff}
#gate{position:fixed;inset:0;z-index:999999;background:#000}
</style>
</head>
<body>
<iframe id="source" title="Private activation animatic capture" src="${source}"></iframe>
<div id="gate" aria-hidden="true"></div>
<script>
const frame=document.querySelector('#source');
const sceneIndex=${scene};
const captureClock=${captureClock};
const formatTime=seconds=>{
  const value=Math.max(0,Math.floor(seconds));
  return Math.floor(value/60)+':'+String(value%60).padStart(2,'0');
};
frame.addEventListener('load',async()=>{
  const doc=frame.contentDocument;
  const ready=()=>doc.querySelectorAll('.watch-panel').length===3&&doc.querySelector('.watch-play');
  for(let attempt=0;attempt<200&&!ready();attempt+=1)await new Promise(r=>setTimeout(r,25));
  if(!ready()){document.documentElement.dataset.captureError='renderer_not_ready';return;}
  await doc.fonts.ready;
  await Promise.all([...doc.images].map(image=>image.complete?Promise.resolve():image.decode().catch(()=>{})));
  if(sceneIndex>0)doc.querySelectorAll('.chapter-button')[sceneIndex].click();
  doc.querySelectorAll('.chapter-button__duration').forEach((node,index)=>{
    node.textContent=formatTime(Math.ceil(captureClock.scenes[index].duration_seconds));
  });
  const sourceTime=doc.querySelector('.watch-time');
  const sourceScrubber=doc.querySelector('.watch-scrubber');
  const exactTime=sourceTime.cloneNode(true);
  const exactScrubber=sourceScrubber.cloneNode(true);
  sourceTime.replaceWith(exactTime);
  sourceScrubber.replaceWith(exactScrubber);
  exactScrubber.max=String(Math.round(captureClock.total_duration_seconds*1000));
  const totalLabel=formatTime(Math.ceil(captureClock.total_duration_seconds));
  const globalStart=captureClock.scenes[sceneIndex].global_start_seconds;
  const updateExactClock=elapsed=>{
    const globalTime=Math.min(captureClock.total_duration_seconds,globalStart+elapsed);
    exactTime.value=formatTime(globalTime)+' / '+totalLabel;
    exactTime.textContent=exactTime.value;
    exactScrubber.value=String(Math.round(globalTime*1000));
  };
  updateExactClock(0);
  window.__startExactClock=()=>{
    const startedAt=performance.now();
    const tick=()=>{
      updateExactClock((performance.now()-startedAt)/1000);
      window.__captureClockFrame=requestAnimationFrame(tick);
    };
    tick();
  };
  const panel=[...doc.querySelectorAll('.watch-panel')].find(node=>!node.hidden);
  window.__captureContract={
    scene_id:panel.dataset.sceneId,
    treatment:panel.dataset.renderTreatment,
    stage_host_count:Number(panel.dataset.stageHostCount),
    caption_avatar_count:Number(panel.dataset.captionAvatarCount),
    generated_media_state:panel.dataset.generatedMediaState,
    motion_mode:panel.dataset.motionMode
  };
  document.documentElement.dataset.captureReady='true';
});
window.beginCapture=()=>{
  if(document.documentElement.dataset.captureReady!=='true')throw new Error('capture_not_ready');
  document.querySelector('#gate').remove();
  frame.contentDocument.querySelector('.watch-play').click();
  window.__startExactClock();
  document.documentElement.dataset.captureStarted='true';
  return window.__captureContract;
};
</script>
</body></html>`;
}

async function createCaptureServer(timeline) {
  const token = randomBytes(32).toString("hex");
  const rejected = new Map();
  let policy;
  const server = createServer(async (request, response) => {
    const parsedRequest = new URL(request.url, "http://127.0.0.1");
    const cookieToken = (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("activation_capture="))
      ?.slice("activation_capture=".length);
    const queryToken = parsedRequest.pathname === "/capture.html"
      ? parsedRequest.searchParams.get("capture_token")
      : null;
    const requestToken = request.headers["x-activation-capture-token"] ?? cookieToken ?? queryToken;
    const authorization = authorizeCaptureRequest({
      method: request.method,
      host: request.headers.host,
      url: request.url,
      token: requestToken,
      policy
    });
    if (!authorization.allowed) {
      rejected.set(authorization.reason, (rejected.get(authorization.reason) ?? 0) + 1);
      response.writeHead(authorization.reason === "token_denied" ? 401 : 404, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end("Not available");
      return;
    }
    try {
      const parsed = parsedRequest;
      if (authorization.path === "/capture.html") {
        const html = captureWrapperHtml(parsed.searchParams, timeline);
        if (!html) {
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Invalid capture request");
          return;
        }
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; img-src 'self'; media-src 'self'",
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": `activation_capture=${token}; HttpOnly; SameSite=Strict; Path=/`,
          "X-Content-Type-Options": "nosniff"
        });
        if (request.method === "HEAD") response.end();
        else response.end(html);
        return;
      }
      const path = resolve(repositoryRoot, `.${authorization.path}`);
      if (!path.startsWith(`${repositoryRoot}${sep}`)) throw new Error("resolved path escaped repository root");
      const metadata = await stat(path);
      if (!metadata.isFile()) throw new Error("capture path is not a file");
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": metadata.size,
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'",
        "Content-Type": MIME_TYPES.get(extname(path)) ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff"
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not available");
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  policy = { port: address.port, token, allowedPaths: ALLOWED_CAPTURE_PATHS };
  return {
    server,
    token,
    port: address.port,
    rejected,
    close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()))
  };
}

async function runAgent(session, token, args, maxBuffer = 4 * 1024 * 1024) {
  return execFile("agent-browser", [
    "--session", session,
    "--headers", JSON.stringify({ "X-Activation-Capture-Token": token }),
    ...args
  ], { cwd: repositoryRoot, maxBuffer });
}

async function blackEndSeconds(path) {
  try {
    const { stderr } = await execFile("ffmpeg", [
      "-hide_banner", "-nostdin", "-i", path,
      "-vf", "blackdetect=d=0.04:pix_th=0.02", "-an", "-f", "null", "-"
    ], { maxBuffer: 8 * 1024 * 1024 });
    const matches = [...`${stderr ?? ""}`.matchAll(/black_end:([0-9.]+)/g)];
    return matches.length ? Number(matches[0][1]) : 0;
  } catch (error) {
    const output = `${error.stderr ?? ""}`;
    const matches = [...output.matchAll(/black_end:([0-9.]+)/g)];
    return matches.length ? Number(matches[0][1]) : 0;
  }
}

async function captureScene({ server, variant, scene, duration, rawPath, outputPath, diagnostics }) {
  const session = `activation-${process.pid}-${variant}-${scene}`;
  const url = `http://127.0.0.1:${server.port}/capture.html?variant=${variant}&scene=${scene}&capture_token=${server.token}`;
  try {
    await Promise.all([rm(rawPath, { force: true }), rm(outputPath, { force: true })]);
    await runAgent(session, server.token, ["set", "viewport", "1280", "720"]);
    await runAgent(session, server.token, ["record", "start", rawPath, url]);
    try {
      await runAgent(session, server.token, ["wait", "html[data-capture-ready=\"true\"]"]);
    } catch (error) {
      const [{ stdout: state }, { stdout: pageErrors }, { stdout: currentUrl }] = await Promise.all([
        runAgent(session, server.token, ["eval", "JSON.stringify({title:document.title,html:document.documentElement.outerHTML.slice(0,500),dataset:{...document.documentElement.dataset},frameText:document.querySelector('#source')?.contentDocument?.body?.innerText?.slice(0,500)})"]).catch(() => ({ stdout: "unavailable" })),
        runAgent(session, server.token, ["errors"]).catch(() => ({ stdout: "unavailable" })),
        runAgent(session, server.token, ["get", "url"]).catch(() => ({ stdout: "unavailable" }))
      ]);
      throw new Error(`capture renderer did not become ready at ${currentUrl.trim()}: ${state.trim()} | ${pageErrors.trim()} | ${error.message}`);
    }
    const { stdout: contractOutput } = await runAgent(session, server.token, ["eval", "JSON.stringify(window.beginCapture())"]);
    const contractText = contractOutput.trim().replace(/^"|"$/g, "").replaceAll('\\"', '"');
    let contract;
    try { contract = JSON.parse(contractText); } catch { contract = { raw: contractOutput.trim() }; }
    await runAgent(session, server.token, ["wait", String(Math.ceil((duration + 0.8) * 1000))]);
    const [{ stdout: consoleOutput }, { stdout: errorOutput }] = await Promise.all([
      runAgent(session, server.token, ["console"]),
      runAgent(session, server.token, ["errors"])
    ]);
    await runAgent(session, server.token, ["record", "stop"]);
    const trimStart = await blackEndSeconds(rawPath);
    await execFile("ffmpeg", [
      "-v", "error", "-nostdin", "-y", "-ss", trimStart.toFixed(6), "-i", rawPath,
      "-vf", "tpad=stop_mode=clone:stop_duration=1,fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
      "-t", duration.toFixed(6), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-movflags", "+faststart", outputPath
    ]);
    diagnostics.push({ variant, scene, route: "/capture.html", contract, trim_start_seconds: trimStart, console: consoleOutput.trim(), errors: errorOutput.trim() });
  } finally {
    await runAgent(session, server.token, ["close"]).catch(() => {});
  }
}

async function concatAndMux({ scenePaths, radioPath, outputPath, totalDuration, temporaryRoot }) {
  const concatPath = join(temporaryRoot, `${sha256(outputPath).slice(0, 12)}-concat.txt`);
  const visualPath = join(temporaryRoot, `${sha256(outputPath).slice(0, 12)}-visual.mp4`);
  const lines = scenePaths.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n");
  await writeFile(concatPath, `${lines}\n`, { mode: 0o600 });
  await execFile("ffmpeg", [
    "-v", "error", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
    "-an", "-c:v", "copy", visualPath
  ]);
  await execFile("ffmpeg", [
    "-v", "error", "-nostdin", "-y", "-i", visualPath, "-i", radioPath,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy",
    "-t", totalDuration.toFixed(6), "-movflags", "+faststart", outputPath
  ]);
}

async function createPosterAndSheet(videoPath, posterPath, sheetPath, totalDuration) {
  await execFile("ffmpeg", [
    "-v", "error", "-nostdin", "-y", "-ss", "0.100", "-i", videoPath,
    "-frames:v", "1", posterPath
  ]);
  const sampleFrames = [
    Math.max(0, Math.round(1 * 30)),
    Math.max(0, Math.round(Math.min(8, totalDuration * 0.42) * 30)),
    Math.max(0, Math.round(Math.min(totalDuration - 0.2, 18) * 30))
  ];
  const select = sampleFrames.map((frame) => `eq(n\\,${frame})`).join("+");
  await execFile("ffmpeg", [
    "-v", "error", "-nostdin", "-y", "-i", videoPath,
    "-vf", `select='${select}',scale=640:360,tile=3x1`, "-frames:v", "1", "-vsync", "vfr", sheetPath
  ]);
}

async function probeMedia(path) {
  const { stdout } = await execFile("ffprobe", [
    "-v", "error", "-show_entries",
    "format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,duration",
    "-of", "json", path
  ]);
  return JSON.parse(stdout);
}

async function audioPayloadHash(path) {
  const { stdout } = await execFile("ffmpeg", [
    "-v", "error", "-nostdin", "-i", path, "-map", "0:a:0", "-c", "copy",
    "-f", "hash", "-hash", "sha256", "-"
  ]);
  const match = stdout.trim().match(/^SHA256=([a-f0-9]{64})$/i);
  if (!match) throw new Error(`could not derive audio payload hash for ${path}`);
  return match[1].toLowerCase();
}

function artifactByKind(run, kind) {
  const artifact = run.artifacts.find((candidate) => candidate.kind === kind);
  if (!artifact) throw new Error(`required run artifact is missing: ${kind}`);
  return artifact;
}

function addOutputArtifact(run, { kind, record, filePath, directInputIds, provenance, reviewState }) {
  const artifact = createArtifactRecord({
    kind,
    outputHash: record.sha256,
    contentLockId: run.current_content_lock_id,
    directInputIds,
    filePath,
    provenance,
    reviewState
  });
  return { run: addArtifact(run, artifact), artifact };
}

export async function buildActivationAnimatics({ stateRoot, runId, skipCapture = false }) {
  if (skipCapture) throw new Error("--skip-capture cannot create a reviewable packet");
  const { run: initialRun, runRoot } = await loadCurrentRun(stateRoot, runId);
  const radio = await resolveRadioBundle(runRoot, initialRun);
  const [models, agentBrowserVersion, ffmpegVersion, illustrationSha256] = await Promise.all([
    buildRendererModels(),
    commandVersion("agent-browser"),
    commandVersion("ffmpeg", ["-version"]),
    hashFile(join(repositoryRoot, "assets/illustrations/ci-activation-programming-safety-card-v1.png"))
  ]);
  const renderEnvironment = {
    browser: agentBrowserVersion,
    os: `${platform()} ${arch()} ${release()}`,
    device_pixel_ratio: 1,
    capture_builder: "activation-animatics/v4-black-sync-mp3-copy-exact-clock-shared-programming",
    capture_tool: agentBrowserVersion,
    media_tool: ffmpegVersion,
    viewport: { width: 1280, height: 720 }
  };
  const comparison = buildAnimaticComparisonManifest({
    runId,
    contentLockId: initialRun.current_content_lock_id,
    radioBundleId: radio.manifest.bundle_id,
    radioCutSha256: radio.manifest.files["radio-cut.mp3"].sha256,
    timelineSha256: radio.manifest.files["timeline.json"].sha256,
    storyboardSha256: radio.manifest.files["storyboard.json"].sha256,
    wordTimingsSha256: radio.manifest.files["word-timings.json"].sha256,
    canvas: { width: 1280, height: 720, fps: 30 },
    renderEnvironment,
    baseline: models.baseline,
    mixed: models.mixed,
    illustrationSha256
  });
  validateAnimaticComparisonManifest(comparison);
  const comparisonSha = comparison.comparison_sha256;
  const outputRoot = join(runRoot, "animatics", comparisonSha);
  const rawRoot = join(outputRoot, "raw-captures");
  const sceneRoot = join(outputRoot, "scene-captures");
  await Promise.all([mkdir(outputRoot, { recursive: true }), mkdir(rawRoot, { recursive: true }), mkdir(sceneRoot, { recursive: true })]);
  await atomicWrite(join(outputRoot, "comparison-manifest.json"), `${JSON.stringify(comparison, null, 2)}\n`);

  const captureServer = await createCaptureServer(radio.timeline);
  const diagnostics = [];
  try {
    for (const variant of ["baseline", "mixed"]) {
      for (const scene of radio.timeline.scenes) {
        if (variant === "mixed" && scene.index === 1) {
          const sharedPath = join(sceneRoot, "baseline-scene-2.mp4");
          const outputPath = join(sceneRoot, "mixed-scene-2.mp4");
          await atomicWrite(outputPath, await readFile(sharedPath));
          diagnostics.push({
            variant,
            scene: scene.index,
            route: null,
            contract: {
              scene_id: scene.scene_id,
              treatment: "diagram_led",
              stage_host_count: 0,
              caption_avatar_count: 1,
              generated_media_state: "animatic",
              motion_mode: "deterministic_low_fidelity"
            },
            exact_scene_reuse: "baseline-scene-2.mp4",
            console: "",
            errors: ""
          });
          continue;
        }
        await captureScene({
          server: captureServer,
          variant,
          scene: scene.index,
          duration: scene.duration_seconds,
          rawPath: join(rawRoot, `${variant}-scene-${scene.index + 1}.webm`),
          outputPath: join(sceneRoot, `${variant}-scene-${scene.index + 1}.mp4`),
          diagnostics
        });
      }
    }
  } finally {
    await captureServer.close();
  }
  const radioPath = join(radio.directory, "radio-cut.mp3");
  const candidatePaths = {
    baseline: join(outputRoot, "candidate-baseline.mp4"),
    mixed: join(outputRoot, "candidate-mixed.mp4")
  };
  for (const variant of ["baseline", "mixed"]) {
    await concatAndMux({
      scenePaths: radio.timeline.scenes.map((scene) => join(sceneRoot, `${variant}-scene-${scene.index + 1}.mp4`)),
      radioPath,
      outputPath: candidatePaths[variant],
      totalDuration: radio.timeline.total_duration_seconds,
      temporaryRoot: outputRoot
    });
  }
  const assignment = Number.parseInt(comparisonSha[0], 16) % 2 === 0
    ? { "Candidate A": "mixed", "Candidate B": "baseline" }
    : { "Candidate A": "baseline", "Candidate B": "mixed" };
  const neutralPaths = {};
  for (const [label, variant] of Object.entries(assignment)) {
    const slug = label.toLowerCase().replace(" ", "-");
    const videoPath = join(outputRoot, `${slug}.mp4`);
    await atomicWrite(videoPath, await readFile(candidatePaths[variant]));
    const posterPath = join(outputRoot, `${slug}-poster.png`);
    const sheetPath = join(outputRoot, `${slug}-contact-sheet.png`);
    await createPosterAndSheet(videoPath, posterPath, sheetPath, radio.timeline.total_duration_seconds);
    neutralPaths[label] = { videoPath, posterPath, sheetPath };
  }
  const probes = {
    candidate_a: await probeMedia(neutralPaths["Candidate A"].videoPath),
    candidate_b: await probeMedia(neutralPaths["Candidate B"].videoPath),
    radio_cut: await probeMedia(radioPath),
    audio_payload_sha256: {
      candidate_a: await audioPayloadHash(neutralPaths["Candidate A"].videoPath),
      candidate_b: await audioPayloadHash(neutralPaths["Candidate B"].videoPath),
      radio_cut: await audioPayloadHash(radioPath)
    }
  };
  const videoDuration = (probe) => Number(probe.format.duration);
  const frameTolerance = 1 / comparison.canvas.fps + 0.001;
  for (const [name, probe] of Object.entries({ candidate_a: probes.candidate_a, candidate_b: probes.candidate_b })) {
    const streams = probe.streams.map((stream) => stream.codec_type).sort();
    if (JSON.stringify(streams) !== JSON.stringify(["audio", "video"])) {
      throw new Error(`${name}: animatic must contain exactly one audio and one video stream`);
    }
    if (Math.abs(videoDuration(probe) - radio.timeline.total_duration_seconds) > frameTolerance) {
      throw new Error(`${name}: duration drift exceeds one output frame`);
    }
  }
  if (Math.abs(videoDuration(probes.candidate_a) - videoDuration(probes.candidate_b)) > 0.000001) {
    throw new Error("candidate duration parity failed");
  }
  if (
    probes.audio_payload_sha256.candidate_a !== probes.audio_payload_sha256.radio_cut ||
    probes.audio_payload_sha256.candidate_b !== probes.audio_payload_sha256.radio_cut
  ) throw new Error("candidate audio payload does not match the exact locked radio cut");
  const diagnosticsRecord = {
    schema_version: "activation-capture-diagnostics/v1",
    private_concept_only: true,
    patient_ready: false,
    server: {
      bind: "127.0.0.1",
      host_policy: "numeric_loopback_exact",
      token_required: true,
      token_persisted: false,
      allowed_paths: [...ALLOWED_CAPTURE_PATHS].sort(),
      rejected_requests: Object.fromEntries(captureServer.rejected)
    },
    captures: diagnostics,
    browser_error_count: diagnostics.filter((entry) => entry.errors && !/No page errors/i.test(entry.errors)).length
  };
  await atomicWrite(join(outputRoot, "capture-diagnostics.json"), `${JSON.stringify(diagnosticsRecord, null, 2)}\n`);
  await atomicWrite(join(outputRoot, "ffprobe.json"), `${JSON.stringify(probes, null, 2)}\n`);

  const outputFiles = {};
  for (const [key, path] of Object.entries({
    comparison_manifest: join(outputRoot, "comparison-manifest.json"),
    candidate_a_video: neutralPaths["Candidate A"].videoPath,
    candidate_b_video: neutralPaths["Candidate B"].videoPath,
    candidate_a_poster: neutralPaths["Candidate A"].posterPath,
    candidate_b_poster: neutralPaths["Candidate B"].posterPath,
    candidate_a_contact_sheet: neutralPaths["Candidate A"].sheetPath,
    candidate_b_contact_sheet: neutralPaths["Candidate B"].sheetPath,
    capture_diagnostics: join(outputRoot, "capture-diagnostics.json"),
    ffprobe: join(outputRoot, "ffprobe.json")
  })) outputFiles[key] = { path, ...(await fileRecord(path)) };

  const reviewManifest = {
    schema_version: "activation-animatic-review-input/v1",
    comparison_id: comparison.comparison_id,
    content_lock_id: comparison.content_lock_id,
    radio_bundle_id: comparison.radio_bundle_id,
    exact_duration_seconds: radio.timeline.total_duration_seconds,
    labels: comparison.review_facing.labels,
    balanced_orders: {
      independent_designer: ["Candidate A", "Candidate B"],
      simulated_user: ["Candidate B", "Candidate A"]
    },
    private_concept_only: true,
    status: "unverified_draft",
    patient_ready: false,
    implementation_rationale_exposed: false,
    require_both_completed_before_rubric: true,
    replay_available: true,
    files: {
      "Candidate A": {
        video: "candidate-a.mp4",
        poster: "candidate-a-poster.png",
        contact_sheet: "candidate-a-contact-sheet.png",
        sha256: outputFiles.candidate_a_video.sha256
      },
      "Candidate B": {
        video: "candidate-b.mp4",
        poster: "candidate-b-poster.png",
        contact_sheet: "candidate-b-contact-sheet.png",
        sha256: outputFiles.candidate_b_video.sha256
      }
    },
    reviewer_instructions: [
      "Review both candidates in the assigned order before opening the rubric.",
      "Replay is allowed. Evaluate the experience; do not infer implementation rationale.",
      "Report critical failures and dimension findings for orientation, comprehension, recall, accessibility, mascot distraction, and caption integrity.",
      "This is a private, unverified concept and is not for patient use."
    ]
  };
  await atomicWrite(join(outputRoot, "review-input.json"), `${JSON.stringify(reviewManifest, null, 2)}\n`);
  outputFiles.review_input = { path: join(outputRoot, "review-input.json"), ...(await fileRecord(join(outputRoot, "review-input.json"))) };
  const internalCaptureManifest = {
    schema_version: "activation-animatic-capture-internal/v1",
    comparison_id: comparison.comparison_id,
    assignment,
    output_files: Object.fromEntries(Object.entries(outputFiles).map(([key, value]) => [key, {
      file: relative(outputRoot, value.path), sha256: value.sha256, byte_length: value.byte_length
    }])),
    radio_cut_sha256: comparison.radio_cut_sha256,
    timeline_sha256: comparison.timeline_sha256,
    storyboard_sha256: comparison.storyboard_sha256,
    word_timings_sha256: comparison.word_timings_sha256,
    render_environment: renderEnvironment,
    private_concept_only: true,
    patient_ready: false
  };
  await atomicWrite(join(outputRoot, "internal-capture-manifest.json"), `${JSON.stringify(internalCaptureManifest, null, 2)}\n`);
  outputFiles.internal_capture_manifest = {
    path: join(outputRoot, "internal-capture-manifest.json"),
    ...(await fileRecord(join(outputRoot, "internal-capture-manifest.json")))
  };

  const timelineArtifact = artifactByKind(initialRun, "activation_timeline_json");
  const storyboardArtifact = artifactByKind(initialRun, "activation_storyboard_json");
  const wordsArtifact = artifactByKind(initialRun, "activation_word_timings_json");
  const radioCutArtifact = artifactByKind(initialRun, "activation_radio_cut_mp3");
  const baseInputs = [
    initialRun.current_content_lock_id,
    radioCutArtifact.candidate_asset_id,
    timelineArtifact.candidate_asset_id,
    storyboardArtifact.candidate_asset_id,
    wordsArtifact.candidate_asset_id
  ];
  const provenance = {
    source: "deterministic_browser_capture",
    builder: "activation-animatics/v1",
    comparison_id: comparison.comparison_id,
    radio_bundle_id: comparison.radio_bundle_id,
    render_environment: renderEnvironment,
    automatic_validation: "passed",
    private_concept_only: true,
    patient_ready: false
  };
  let nextRun = initialRun;
  const packetArtifactIds = [];
  const artifactRecords = {};
  for (const [key, kind, reviewState, directInputs] of [
    ["comparison_manifest", "activation_animatic_comparison_manifest", "approved", baseInputs],
    ["candidate_a_video", "activation_animatic_candidate_video", "unreviewed", baseInputs],
    ["candidate_b_video", "activation_animatic_candidate_video", "unreviewed", baseInputs]
  ]) {
    const result = addOutputArtifact(nextRun, {
      kind,
      record: outputFiles[key],
      filePath: relative(runRoot, outputFiles[key].path),
      directInputIds: directInputs,
      provenance: { ...provenance, neutral_label: key.includes("candidate_a") ? "Candidate A" : key.includes("candidate_b") ? "Candidate B" : null },
      reviewState
    });
    nextRun = result.run;
    artifactRecords[key] = result.artifact;
    packetArtifactIds.push(result.artifact.candidate_asset_id);
  }
  for (const [key, label] of [
    ["candidate_a_poster", "Candidate A"],
    ["candidate_b_poster", "Candidate B"],
    ["candidate_a_contact_sheet", "Candidate A"],
    ["candidate_b_contact_sheet", "Candidate B"]
  ]) {
    const videoKey = key.startsWith("candidate_a") ? "candidate_a_video" : "candidate_b_video";
    const result = addOutputArtifact(nextRun, {
      kind: key.includes("poster") ? "activation_animatic_poster" : "activation_animatic_contact_sheet",
      record: outputFiles[key],
      filePath: relative(runRoot, outputFiles[key].path),
      directInputIds: [artifactRecords[videoKey].candidate_asset_id],
      provenance: { ...provenance, neutral_label: label },
      reviewState: "unreviewed"
    });
    nextRun = result.run;
    artifactRecords[key] = result.artifact;
    packetArtifactIds.push(result.artifact.candidate_asset_id);
  }
  for (const [key, kind] of [
    ["review_input", "activation_animatic_review_input"],
    ["capture_diagnostics", "activation_animatic_capture_diagnostics"],
    ["ffprobe", "activation_animatic_ffprobe_report"]
  ]) {
    const result = addOutputArtifact(nextRun, {
      kind,
      record: outputFiles[key],
      filePath: relative(runRoot, outputFiles[key].path),
      directInputIds: [
        artifactRecords.candidate_a_video.candidate_asset_id,
        artifactRecords.candidate_b_video.candidate_asset_id
      ],
      provenance,
      reviewState: "approved"
    });
    nextRun = result.run;
    artifactRecords[key] = result.artifact;
    packetArtifactIds.push(result.artifact.candidate_asset_id);
  }
  const packet = createPacketRecord({
    packetType: "activation_animatic_comparison",
    contentLockId: initialRun.current_content_lock_id,
    artifactIds: packetArtifactIds,
    manifest: {
      comparison_id: comparison.comparison_id,
      radio_bundle_id: comparison.radio_bundle_id,
      review_input_sha256: outputFiles.review_input.sha256,
      neutral_labels: ["Candidate A", "Candidate B"],
      private_concept_only: true,
      patient_ready: false,
      review_state: "pending_independent_receipts"
    }
  });
  nextRun = addPacket(nextRun, packet);
  const packetSummary = {
    schema_version: "activation-animatic-review-packet/v1",
    packet_id: packet.packet_id,
    packet_hash: packet.packet_id.slice("packet:".length),
    comparison_id: comparison.comparison_id,
    run_id: runId,
    revision_state: "pending_independent_receipts",
    review_input: "review-input.json",
    challenge_required: true,
    roles_required: ["independent_designer", "simulated_user"],
    private_concept_only: true,
    patient_ready: false
  };
  await atomicWrite(join(outputRoot, "packet.json"), `${JSON.stringify(packetSummary, null, 2)}\n`);
  const persistence = await persistRunRevision(stateRoot, nextRun);
  return {
    run_id: runId,
    revision_id: persistence.revision_id,
    packet_id: packet.packet_id,
    packet_hash: packet.packet_id.slice(7),
    comparison_id: comparison.comparison_id,
    radio_bundle_id: comparison.radio_bundle_id,
    output_directory: relative(repositoryRoot, outputRoot),
    exact_radio_duration_seconds: radio.timeline.total_duration_seconds,
    candidate_a_duration_seconds: videoDuration(probes.candidate_a),
    candidate_b_duration_seconds: videoDuration(probes.candidate_b),
    duration_parity_seconds: Math.abs(videoDuration(probes.candidate_a) - videoDuration(probes.candidate_b)),
    stream_types: probes.candidate_a.streams.map((stream) => stream.codec_type).sort(),
    browser_error_count: diagnosticsRecord.browser_error_count,
    output_hashes: Object.fromEntries(Object.entries(outputFiles).map(([key, value]) => [key, value.sha256])),
    review_state: "pending_independent_receipts",
    stage: nextRun.stage,
    status: nextRun.status,
    resume_action: nextRun.resume_action
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await buildActivationAnimatics(options);
  process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : [
    `Activation animatic packet ${result.packet_id}`,
    `Output: ${result.output_directory}`,
    `Candidates: ${result.candidate_a_duration_seconds}s / ${result.candidate_b_duration_seconds}s`,
    `Review: ${result.review_state}`,
    `Revision: ${result.revision_id}`
  ].join("\n")}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
