import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildScrollyProjection,
  validateScrollyProjection
} from "./lib/activation-export.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;

function parseArguments(argv) {
  const options = {
    runId: null,
    stateRoot: resolve(repositoryRoot, ".production/activation"),
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--run-id") {
      options.runId = value;
      index += 1;
    } else if (argument === "--state-root") {
      options.stateRoot = resolve(value);
      index += 1;
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new Error("unknown argument: " + argument);
    }
  }
  if (!RUN_ID_PATTERN.test(options.runId ?? "")) {
    throw new Error("--run-id is required and must be valid");
  }
  return options;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + ".tmp-" + process.pid;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function immutableWrite(path, contents) {
  if (await exists(path)) {
    const prior = await readFile(path);
    const next = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    if (!prior.equals(next)) throw new Error("immutable scrolly output collision: " + path);
    return true;
  }
  await atomicWrite(path, contents);
  return false;
}

function artifact(run, kind) {
  const matches = run.artifacts.filter(
    (candidate) =>
      candidate.kind === kind &&
      candidate.content_lock_id === run.current_content_lock_id &&
      run.valid_artifacts.includes(candidate.candidate_asset_id)
  );
  if (matches.length !== 1) {
    throw new Error("expected one current approved artifact of kind " + kind);
  }
  return matches[0];
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runRoot = join(options.stateRoot, "runs", options.runId);
  const pointer = JSON.parse(await readFile(join(runRoot, "current.json"), "utf8"));
  const run = JSON.parse(
    await readFile(join(runRoot, "revisions", pointer.revision_id.slice(9) + ".json"), "utf8")
  );
  const timelineArtifact = artifact(run, "activation_timeline_json");
  const transcriptArtifact = artifact(run, "activation_transcript_txt");
  const captionsArtifact = artifact(run, "activation_captions_vtt");
  const manifestArtifact = artifact(run, "activation_radio_manifest");
  const [production, timeline, transcript, radioManifest] = await Promise.all([
    readFile(join(repositoryRoot, "content/productions/ci-activation-v0.1.0.json"), "utf8").then(JSON.parse),
    readFile(join(runRoot, timelineArtifact.file_path), "utf8").then(JSON.parse),
    readFile(join(runRoot, transcriptArtifact.file_path), "utf8"),
    readFile(join(runRoot, manifestArtifact.file_path), "utf8").then(JSON.parse)
  ]);

  const projection = buildScrollyProjection({
    production,
    timeline,
    transcript,
    contentLockId: run.current_content_lock_id,
    radioBundleId: radioManifest.bundle_id,
    assetPaths: {
      host: "assets/dr-hoots-motion-base-v2.png",
      diagram: "assets/ci-activation-programming-safety-card-v1.png",
      captions: "assets/captions.vtt"
    }
  });
  validateScrollyProjection(projection);

  const projectionHash = projection.manifest.projection_id.slice("projection:".length);
  const outputRoot = join(runRoot, "exports", "scrolly", projectionHash);
  const assetRoot = join(outputRoot, "assets");
  await mkdir(assetRoot, { recursive: true });
  const outputs = {
    html: join(outputRoot, "scrollytelling.html"),
    manifest: join(outputRoot, "manifest.json"),
    host: join(assetRoot, "dr-hoots-motion-base-v2.png"),
    diagram: join(assetRoot, "ci-activation-programming-safety-card-v1.png"),
    captions: join(assetRoot, "captions.vtt")
  };

  const reused = {
    html: await immutableWrite(outputs.html, projection.html),
    manifest: await immutableWrite(outputs.manifest, JSON.stringify(projection.manifest, null, 2) + "\n")
  };
  for (const [key, source] of [
    ["host", join(repositoryRoot, "assets/character/dr-hoots-motion-base-v2.png")],
    ["diagram", join(repositoryRoot, "assets/illustrations/ci-activation-programming-safety-card-v1.png")],
    ["captions", join(runRoot, captionsArtifact.file_path)]
  ]) {
    if (await exists(outputs[key])) {
      reused[key] = true;
    } else {
      await copyFile(source, outputs[key]);
      reused[key] = false;
    }
  }

  const result = {
    projection_id: projection.manifest.projection_id,
    output_root: outputRoot,
    html: outputs.html,
    manifest: outputs.manifest,
    reused,
    promoted: false,
    private_concept_only: true,
    patient_ready: false,
    run_stage: run.stage,
    run_status: run.status,
    note: "Static semantic scrollytelling is prebuilt; final packet promotion remains gated on approved motion and finished review."
  };
  process.stdout.write((options.json ? JSON.stringify(result, null, 2) : JSON.stringify(result)) + "\n");
}

main().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
