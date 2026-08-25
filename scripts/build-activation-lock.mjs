import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildContentLock,
  createProductionRun,
  persistContentLock,
  persistRunRevision
} from "./lib/production-run.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const INPUT_PATHS = Object.freeze({
  canonical_module: "content/canonical/ci-phase0-v0.1.0.json",
  shared_scene_contract: "content/scenes/ci-phase0-v0.1.0.scenes.json",
  activation_adaptation: "content/adaptations/activation-programming-v0.1.0.json",
  activation_production_contract: "content/productions/ci-activation-v0.1.0.json",
  character_manifest: "assets/character/manifest.json",
  illustration_manifest: "assets/illustrations/manifest.json",
  character_motion_base: "assets/character/dr-hoots-motion-base-v2.png",
  character_motion_wing: "assets/character/dr-hoots-wing-rig-v2.png",
  character_gesture_sheet: "assets/character/dr-hoots-gestures-v3.png",
  programming_illustration: "assets/illustrations/ci-activation-programming-safety-card-v1.png",
  renderer_javascript: "assets/variations.js",
  renderer_styles: "assets/variations.css",
  renderer_entry: "variations.html"
});

function parseArguments(argv) {
  const options = {
    stateRoot: resolve(repositoryRoot, ".production/activation"),
    runId: null,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--state-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--state-root requires a path");
      options.stateRoot = resolve(value);
      index += 1;
    } else if (argument === "--run-id") {
      const value = argv[index + 1];
      if (!value) throw new Error("--run-id requires a value");
      options.runId = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

async function firstVersionLine(command, args) {
  try {
    const { stdout, stderr } = await execFile(command, args, {
      cwd: repositoryRoot,
      timeout: 5_000,
      maxBuffer: 256 * 1024
    });
    const line = `${stdout}\n${stderr}`
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean);
    if (!line) throw new Error("returned no version string");
    return line;
  } catch (error) {
    throw new Error(`required render dependency ${command} is unavailable: ${error.message}`);
  }
}

async function collectToolVersions() {
  const [ffmpeg, ffprobe, agentBrowser] = await Promise.all([
    firstVersionLine("ffmpeg", ["-version"]),
    firstVersionLine("ffprobe", ["-version"]),
    firstVersionLine("agent-browser", ["--version"])
  ]);
  return {
    node: process.version,
    ffmpeg,
    ffprobe,
    agent_browser: agentBrowser,
    operating_system: `${platform()}-${release()}-${arch()}`,
    production_run_schema: "activation-production-run/v1"
  };
}

async function collectInputs() {
  return Promise.all(
    Object.entries(INPUT_PATHS).map(async ([id, sourcePath]) => ({
      id,
      sourcePath,
      content: await readFile(resolve(repositoryRoot, sourcePath))
    }))
  );
}

export async function buildActivationLock() {
  const [inputs, toolVersions] = await Promise.all([collectInputs(), collectToolVersions()]);
  return buildContentLock({
    inputs,
    renderConfig: {
      canvas: { width: 1280, height: 720 },
      viewport: { width: 1280, height: 720 },
      device_pixel_ratio: 1,
      locale: "en-US",
      timezone: "UTC",
      reduced_motion_capture: true,
      font_families: ["system-ui", "sans-serif"],
      bundled_font_hashes: []
    },
    toolVersions
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const contentLock = await buildActivationLock();
  const lockPersistence = await persistContentLock(options.stateRoot, contentLock);
  const runId = options.runId ?? `activation-${contentLock.input_graph_sha256.slice(0, 16)}`;
  const run = createProductionRun({ runId, contentLock });
  const runPersistence = await persistRunRevision(options.stateRoot, run);
  const result = {
    run_id: runId,
    content_lock_id: contentLock.lock_id,
    input_graph_sha256: contentLock.input_graph_sha256,
    stage: run.stage,
    status: run.status,
    reason_code: run.reason_code,
    resume_action: run.resume_action,
    state_root: relative(repositoryRoot, options.stateRoot) || ".",
    lock_reused: lockPersistence.reused,
    run_revision_reused: runPersistence.reused,
    revision_id: runPersistence.revision_id
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Activation content lock ${result.content_lock_id} (${result.lock_reused ? "reused" : "created"}); ` +
        `run ${result.run_id} is ${result.status} at ${result.stage}. ` +
        `Resume with: ${result.resume_action}.\n`
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
