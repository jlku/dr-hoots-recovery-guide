import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { addArtifact, addPacket, applyRunEvent, createArtifactRecord, createPacketRecord, getArtifactState, persistRunRevision, validateRunState } from "./lib/production-run.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;
const COMPARISON_ID = "comparison:ddbabe09734e681ee72ea52d93a9f50bf3aa91c9fd8a1ca564f39303a008d8cf";

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function parseArguments(argv) {
  const options = { runId: null, stateRoot: resolve(repositoryRoot, ".production/activation"), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--run-id") { options.runId = argv[index + 1]; index += 1; }
    else if (argv[index] === "--state-root") { options.stateRoot = resolve(argv[index + 1]); index += 1; }
    else if (argv[index] === "--json") options.json = true;
    else throw new Error("unknown argument: " + argv[index]);
  }
  if (!RUN_ID_PATTERN.test(options.runId ?? "")) throw new Error("--run-id is required");
  return options;
}
function artifact(run, kind) {
  const matches = run.artifacts.filter((item) => item.kind === kind && item.content_lock_id === run.current_content_lock_id && run.valid_artifacts.includes(item.candidate_asset_id));
  if (matches.length !== 1) throw new Error("expected one current approved artifact of kind " + kind);
  return matches[0];
}
function hostArtifact(run, performanceId) {
  const matches = run.artifacts.filter((item) => item.kind === "activation_host_performance_composition_candidate" && item.provenance.settings.performance_id === performanceId && getArtifactState(run, item.candidate_asset_id) === "renderable");
  if (matches.length !== 1) throw new Error("expected one approved composition for " + performanceId);
  return matches[0];
}
async function hashFile(path) { return sha256(await readFile(path)); }
async function runFfmpeg(args) { await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]); }
function noticeFilter(prefix = "") {
  // Preserve the reviewed private-prototype banner already baked into the animatic source.
  return `${prefix}null`;
}
async function renderHostVisual({ base, host, output, duration }) {
  const filter = `[0:v]drawbox=x=455:y=58:w=350:h=280:color=#dcebf2:t=fill[base];[1:v]scale=350:197[host];[base][host]overlay=455:98:eof_action=repeat:shortest=0[composed];[composed]${noticeFilter()}[v]`;
  await runFfmpeg(["-i", base, "-i", host, "-filter_complex", filter, "-map", "[v]", "-an", "-t", String(duration), "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", output]);
}
async function renderDiagramVisual({ base, output, duration }) {
  await runFfmpeg(["-i", base, "-vf", noticeFilter(), "-an", "-t", String(duration), "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", output]);
}
async function muxScene({ visual, audio, output, duration }) {
  await runFfmpeg(["-i", visual, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-t", String(duration), output]);
}
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runRoot = join(options.stateRoot, "runs", options.runId);
  const pointer = JSON.parse(await readFile(join(runRoot, "current.json"), "utf8"));
  let run = JSON.parse(await readFile(join(runRoot, "revisions", pointer.revision_id.slice(9) + ".json"), "utf8"));
  validateRunState(run);
  if (run.stage !== "export_assembly" || run.reason_code !== "finished_exports_required") throw new Error("finished exports require approved motion candidates");

  const healing = hostArtifact(run, "host/healing");
  const followup = hostArtifact(run, "host/follow-up");
  const radio = artifact(run, "activation_radio_cut_mp3");
  const radioManifestArtifact = artifact(run, "activation_radio_manifest");
  const timelineArtifact = artifact(run, "activation_timeline_json");
  const captionsVtt = artifact(run, "activation_captions_vtt");
  const captionsSrt = artifact(run, "activation_captions_srt");
  const timeline = JSON.parse(await readFile(join(runRoot, timelineArtifact.file_path), "utf8"));
  const radioManifest = JSON.parse(await readFile(join(runRoot, radioManifestArtifact.file_path), "utf8"));
  const animaticPacket = run.packets.find((packet) => packet.manifest?.comparison_id === COMPARISON_ID);
  if (!animaticPacket) throw new Error("approved animatic packet is missing");
  const mixedAnimatic = run.artifacts.find((item) => animaticPacket.artifact_ids.includes(item.candidate_asset_id) && item.kind === "activation_animatic_candidate_video" && item.provenance.neutral_label === "Candidate B");
  if (!mixedAnimatic) throw new Error("approved mixed animatic source is missing");

  const exportIdentity = sha256(JSON.stringify({ content_lock_id: run.current_content_lock_id, radio: radio.candidate_asset_id, timeline: timelineArtifact.candidate_asset_id, animatic: mixedAnimatic.candidate_asset_id, healing: healing.candidate_asset_id, followup: followup.candidate_asset_id, layout: "activation-finished-layout/v2-full-frame-concat" }));
  const outputRoot = join(runRoot, "exports", "finished", exportIdentity);
  const visualRoot = join(outputRoot, "visuals");
  const clipRoot = join(outputRoot, "clips");
  const posterRoot = join(outputRoot, "posters");
  await Promise.all([mkdir(visualRoot, { recursive: true }), mkdir(clipRoot, { recursive: true }), mkdir(posterRoot, { recursive: true })]);
  const animaticRoot = join(runRoot, "animatics", COMPARISON_ID.slice("comparison:".length));
  const sceneDefs = [
    { key: "healing", scene: timeline.scenes[0], base: join(animaticRoot, "scene-captures", "mixed-scene-1.mp4"), host: join(runRoot, healing.file_path), audio: join(repositoryRoot, "assets/audio/healing.mp3") },
    { key: "programming", scene: timeline.scenes[1], base: join(animaticRoot, "scene-captures", "mixed-scene-2.mp4"), host: null, audio: join(repositoryRoot, "assets/audio/chaptered-programming.mp3") },
    { key: "follow-up", scene: timeline.scenes[2], base: join(animaticRoot, "scene-captures", "mixed-scene-3.mp4"), host: join(runRoot, followup.file_path), audio: join(repositoryRoot, "assets/audio/follow-up.mp3") }
  ];
  const clips = [];
  for (const definition of sceneDefs) {
    const visual = join(visualRoot, definition.key + ".mp4");
    const clip = join(clipRoot, definition.key + ".mp4");
    if (definition.host) await renderHostVisual({ base: definition.base, host: definition.host, output: visual, duration: definition.scene.duration_seconds });
    else await renderDiagramVisual({ base: definition.base, output: visual, duration: definition.scene.duration_seconds });
    await muxScene({ visual, audio: definition.audio, output: clip, duration: definition.scene.duration_seconds });
    clips.push({ ...definition, visual, clip });
  }
  const master = join(outputRoot, "activation-master.mp4");
  await runFfmpeg(["-i", clips[0].visual, "-i", clips[1].visual, "-i", clips[2].visual, "-i", join(runRoot, radio.file_path), "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-t", String(timeline.total_duration_seconds), master]);
  const captionsOutVtt = join(outputRoot, "captions.vtt");
  const captionsOutSrt = join(outputRoot, "captions.srt");
  await Promise.all([copyFile(join(runRoot, captionsVtt.file_path), captionsOutVtt), copyFile(join(runRoot, captionsSrt.file_path), captionsOutSrt)]);
  for (const entry of clips) await runFfmpeg(["-ss", "0.3", "-i", entry.clip, "-frames:v", "1", join(posterRoot, entry.key + ".png")]);
  const masterPoster = join(posterRoot, "master.png");
  const contactSheet = join(posterRoot, "master-contact-sheet.png");
  await runFfmpeg(["-ss", "0.3", "-i", master, "-frames:v", "1", masterPoster]);
  await runFfmpeg(["-i", master, "-vf", "fps=1/3,scale=320:-1,tile=4x2", "-frames:v", "1", contactSheet]);

  const outputSpecs = [
    ["activation_finished_scene_video", clips[0].clip, [healing.candidate_asset_id, mixedAnimatic.candidate_asset_id, radio.candidate_asset_id]],
    ["activation_finished_scene_video", clips[1].clip, [mixedAnimatic.candidate_asset_id, radio.candidate_asset_id]],
    ["activation_finished_scene_video", clips[2].clip, [followup.candidate_asset_id, mixedAnimatic.candidate_asset_id, radio.candidate_asset_id]],
    ["activation_finished_master_video", master, [healing.candidate_asset_id, followup.candidate_asset_id, mixedAnimatic.candidate_asset_id, radio.candidate_asset_id]],
    ["activation_finished_captions_vtt", captionsOutVtt, [captionsVtt.candidate_asset_id]],
    ["activation_finished_captions_srt", captionsOutSrt, [captionsSrt.candidate_asset_id]],
    ["activation_finished_master_poster", masterPoster, [healing.candidate_asset_id, mixedAnimatic.candidate_asset_id]],
    ["activation_finished_contact_sheet", contactSheet, [healing.candidate_asset_id, followup.candidate_asset_id, mixedAnimatic.candidate_asset_id]]
  ];
  const artifactIds = [];
  const records = [];
  for (const [kind, path, inputs] of outputSpecs) {
    const record = createArtifactRecord({ kind, outputHash: await hashFile(path), contentLockId: run.current_content_lock_id, directInputIds: inputs, filePath: path.slice(runRoot.length + 1), reviewState: "unreviewed", provenance: { source: "derived", tool: "ffmpeg", layout: "activation-finished-layout/v2-full-frame-concat", settings: { private_concept_only: true, patient_ready: false } } });
    run = addArtifact(run, record); artifactIds.push(record.candidate_asset_id); records.push(record);
  }
  const manifest = { schema_version: "activation-finished-export/v1", export_id: "export:" + exportIdentity, content_lock_id: run.current_content_lock_id, radio_bundle_id: radioManifest.bundle_id, duration_seconds: timeline.total_duration_seconds, scene_order: timeline.scenes.map((scene) => scene.scene_id), output_hashes: Object.fromEntries(records.map((record) => [record.kind + ":" + record.file_path.split("/").at(-1), record.output_hash])), private_concept_only: true, patient_ready: false, review_state: "pending_finished_review" };
  const manifestPath = join(outputRoot, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  const manifestRecord = createArtifactRecord({ kind: "activation_finished_manifest", outputHash: await hashFile(manifestPath), contentLockId: run.current_content_lock_id, directInputIds: artifactIds, filePath: manifestPath.slice(runRoot.length + 1), reviewState: "unreviewed", provenance: { source: "derived", tool: "activation-finished-builder/v1", settings: { private_concept_only: true, patient_ready: false } } });
  run = addArtifact(run, manifestRecord); artifactIds.push(manifestRecord.candidate_asset_id);
  const packet = createPacketRecord({ packetType: "activation_finished_private", contentLockId: run.current_content_lock_id, artifactIds, manifest: { export_id: manifest.export_id, review_state: "pending_finished_review", private_concept_only: true, patient_ready: false } });
  run = addPacket(run, packet);
  run = applyRunEvent(run, "exports_assembled");
  const persistence = await persistRunRevision(options.stateRoot, run);
  const output = { packet_id: packet.packet_id, export_id: manifest.export_id, output_root: outputRoot, master, clips: clips.map((entry) => entry.clip), captions: [captionsOutVtt, captionsOutSrt], poster: masterPoster, contact_sheet: contactSheet, revision_id: persistence.revision_id, stage: run.stage, status: run.status, review_state: "pending_finished_review", private_concept_only: true, patient_ready: false };
  process.stdout.write((options.json ? JSON.stringify(output, null, 2) : JSON.stringify(output)) + "\n");
}

main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
