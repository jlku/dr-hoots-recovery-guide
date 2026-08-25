import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { addArtifact, createArtifactRecord, getArtifactState, persistRunRevision, validateRunState } from "./lib/production-run.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID_PATTERN = /^(?=.{1,128}$)(?=.*[^.])[A-Za-z0-9._-]+$/;
const TRANSFORM = "crop=960:540:0:60,scale=1280:720";

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function parseArguments(argv) {
  const options = { runId: null, stateRoot: resolve(repositoryRoot, ".production/activation"), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--run-id") { options.runId = argv[index + 1]; index += 1; }
    else if (argument === "--state-root") { options.stateRoot = resolve(argv[index + 1]); index += 1; }
    else if (argument === "--json") options.json = true;
    else throw new Error("unknown argument: " + argument);
  }
  if (!RUN_ID_PATTERN.test(options.runId ?? "")) throw new Error("--run-id is required");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runRoot = join(options.stateRoot, "runs", options.runId);
  const pointer = JSON.parse(await readFile(join(runRoot, "current.json"), "utf8"));
  let run = JSON.parse(await readFile(join(runRoot, "revisions", pointer.revision_id.slice(9) + ".json"), "utf8"));
  validateRunState(run);
  if (run.stage !== "motion_generation") throw new Error("host compositions require motion_generation stage");

  const outputs = [];
  for (const performanceId of ["host/healing", "host/follow-up"]) {
    const sources = run.artifacts.filter((artifact) => artifact.kind === "activation_host_performance_candidate" && artifact.provenance.settings.performance_id === performanceId && getArtifactState(run, artifact.candidate_asset_id) === "unreviewed_nonrenderable");
    const source = sources.at(-1);
    if (!source) throw new Error("missing unreviewed provider source for " + performanceId);
    const outputDirectory = join(runRoot, "compositions", source.output_hash);
    const outputPath = join(outputDirectory, "medium-16x9.mp4");
    await mkdir(outputDirectory, { recursive: true });
    await execFileAsync("ffmpeg", ["-y", "-i", join(runRoot, source.file_path), "-vf", TRANSFORM, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", outputPath]);
    const bytes = await readFile(outputPath);
    const relativePath = outputPath.slice(runRoot.length + 1);
    const artifact = createArtifactRecord({
      kind: "activation_host_performance_composition_candidate",
      outputHash: sha256(bytes),
      contentLockId: run.current_content_lock_id,
      directInputIds: [source.candidate_asset_id],
      filePath: relativePath,
      reviewState: "unreviewed",
      provenance: {
        source: "derived",
        transform: TRANSFORM,
        tool: "ffmpeg",
        settings: {
          performance_id: performanceId,
          framing: "medium_16x9",
          excludes_raw_floor_region: true,
          source_provider_request_id: source.provenance.request_id
        }
      }
    });
    run = addArtifact(run, artifact);
    outputs.push({ performance_id: performanceId, candidate_asset_id: artifact.candidate_asset_id, source_asset_id: source.candidate_asset_id, output_sha256: artifact.output_hash, file_path: artifact.file_path, transform: TRANSFORM, review_state: "unreviewed" });
  }
  const persistence = await persistRunRevision(options.stateRoot, run);
  const result = { revision_id: persistence.revision_id, outputs, patient_ready: false };
  process.stdout.write((options.json ? JSON.stringify(result, null, 2) : JSON.stringify(result)) + "\n");
}

main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
