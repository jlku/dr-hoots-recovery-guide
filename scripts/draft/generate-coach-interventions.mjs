// Four narration-bound host performances for the private Watch prototype:
// two full-body category introductions and two circular coach interventions.
// Paid calls require an exact one-pass cap and immutable operator-message evidence.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createFalClient } from "@fal-ai/client";

import {
  MODEL_ID,
  buildProviderHeaders,
  calculateMaximumCostUsd
} from "../lib/provider-boundary.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const imagePath = "assets/character/dr-hoots-motion-base-v3-canon.png";
const outputRoot = path.join(projectRoot, "preview", "assets", "media");
const rawRoot = path.join(projectRoot, "artifacts", "coach-interventions", "raw");
const manifestPath = path.join(projectRoot, "assets", "video", "coach-interventions-manifest.json");

const commonPrompt =
  "Locked camera. Dr. Hoots, the same clay owl in teal scrubs, speaks the supplied narration with clear restrained beak movement, one natural blink, and subtle attentive head motion. Both feathered wings remain visible, resting at the sides, and completely still. Preserve the exact eyes, beak, feathers, proportions, scrubs, gold pin, pockets, pale blue background, framing, and lighting. Absolutely no text, subtitles, letters, numbers, logos, decorative shapes, pointing, touching, clinical demonstration, hands, extra limbs, morphing, camera movement, or background movement.";

const categoryPrompt =
  "Locked camera. Dr. Hoots, the same clay owl in teal scrubs, speaks the supplied short category introduction with clear restrained beak movement and a warm attentive expression. Use one small open-wing presenting gesture at waist height, then settle both feathered wings back at the sides. This is a navigation transition, not a clinical demonstration. Preserve the exact eyes, beak, feathers, proportions, scrubs, gold pin, pockets, feet, pale blue background, framing, and lighting. Absolutely no text, subtitles, letters, numbers, logos, decorative shapes, literal pointing, touching, ear gestures, clinical demonstration, hands, extra limbs, morphing, camera movement, or background movement.";

const interventions = [
  {
    id: "host/part1-intro",
    scene_id: "part1",
    narration_id: "part1-intro",
    treatment: "full_body_category_host",
    audio: "assets/audio/draft/part1-intro.mp3",
    duration_seconds: 3.004063,
    file: "host-part1-intro.mp4",
    prompt: categoryPrompt
  },
  {
    id: "host/part2-intro",
    scene_id: "part2",
    narration_id: "part2-intro",
    treatment: "full_body_category_host",
    audio: "assets/audio/draft/part2-intro.mp3",
    duration_seconds: 3.082438,
    file: "host-part2-intro.mp4",
    prompt: categoryPrompt
  },
  {
    id: "coach/wound-paths",
    scene_id: "s-paths",
    narration_id: "wound-paths",
    treatment: "circular_coach_intervention",
    audio: "assets/audio/draft/wound-paths.mp3",
    duration_seconds: 18.4,
    file: "coach-wound-paths.mp4",
    prompt: commonPrompt
  },
  {
    id: "coach/call-numbers",
    scene_id: "s-numbers",
    narration_id: "call-numbers",
    treatment: "circular_coach_intervention",
    audio: "assets/audio/draft/call-numbers.mp3",
    duration_seconds: 24,
    file: "coach-call-numbers.mp4",
    prompt: commonPrompt
  }
].map((item) => ({
  ...item,
  maximum_cost_usd: calculateMaximumCostUsd(item.duration_seconds)
}));

const exactCap = Number(interventions.reduce((sum, item) => sum + item.maximum_cost_usd, 0).toFixed(2));
const args = process.argv.slice(2);
const generating = args.includes("--generate");
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};

const plan = {
  schema_version: "coach-intervention-generation-plan/v1",
  provider: "fal",
  model_id: MODEL_ID,
  source_image: imagePath,
  performances: interventions,
  exact_one_pass_cap_usd: exactCap,
  attempts_per_performance: 1,
  private_concept_only: true,
  patient_ready: false,
  provider_call_allowed: generating
};

if (!generating) {
  process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  process.exit(0);
}

const acceptedCap = Number(valueAfter("--accepted-cap-usd"));
const acceptanceEvidence = valueAfter("--acceptance-evidence");
if (acceptedCap !== exactCap) {
  throw new Error(`--accepted-cap-usd must exactly match the USD ${exactCap.toFixed(2)} one-pass cap`);
}
if (!/^operator-message-sha256:[a-f0-9]{64}$/.test(acceptanceEvidence ?? "")) {
  throw new Error("--acceptance-evidence must be an operator-message-sha256 identity");
}
if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing. Run with --env-file=.env.local.");

const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

const client = createFalClient({
  credentials: process.env.FAL_KEY,
  requestMiddleware: async (request) => ({
    ...request,
    headers: { ...(request.headers ?? {}), ...buildProviderHeaders() }
  })
});

await mkdir(outputRoot, { recursive: true });
await mkdir(rawRoot, { recursive: true });
const imageBytes = await readFile(path.join(projectRoot, imagePath));
const imageFile = new File([imageBytes], path.basename(imagePath), { type: "image/png" });
const imageUrl = await client.storage.upload(imageFile);
const records = [];

for (const intervention of interventions) {
  const outputPath = path.join(outputRoot, intervention.file);
  if (await exists(outputPath)) throw new Error(`${intervention.file} already exists; refusing an untracked paid retry`);

  const audioBytes = await readFile(path.join(projectRoot, intervention.audio));
  const audioFile = new File([audioBytes], path.basename(intervention.audio), { type: "audio/mpeg" });
  const audioUrl = await client.storage.upload(audioFile);
  const result = await client.subscribe(MODEL_ID, {
    input: { image_url: imageUrl, audio_url: audioUrl, prompt: intervention.prompt }
  });
  const videoUrl = result.data?.video?.url;
  if (!videoUrl) throw new Error(`FAL returned no video for ${intervention.id}`);
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`download failed for ${intervention.id}: ${response.status}`);
  const rawPath = path.join(rawRoot, intervention.file.replace(/\.mp4$/, "-raw.mp4"));
  await writeFile(rawPath, Buffer.from(await response.arrayBuffer()));

  // The provider has previously burned pseudo-captions into its lower band.
  // Keep the original for audit. Circular interventions use a tighter square
  // portrait crop so the text cannot enter the visible Loom-style bubble.
  const videoFilter = intervention.treatment === "circular_coach_intervention"
    ? "crop=600:560:180:0,scale=600:600"
    : "crop=iw:ih-148";
  await execFileAsync("ffmpeg", [
    "-y", "-v", "error", "-i", rawPath,
    "-vf", videoFilter, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    outputPath
  ]);
  const poster = outputPath.replace(/\.mp4$/, "-poster.png");
  const sheet = outputPath.replace(/\.mp4$/, "-contact-sheet.png");
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-ss", "0.1", "-i", outputPath, "-frames:v", "1", poster]);
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-i", outputPath, "-vf", "fps=1/3,scale=260:-1,tile=8x2", "-frames:v", "1", sheet]);
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outputPath]);
  records.push({
    ...intervention,
    request_id: result.requestId,
    output: `preview/assets/media/${intervention.file}`,
    poster: `preview/assets/media/${path.basename(poster)}`,
    contact_sheet: `preview/assets/media/${path.basename(sheet)}`,
    duration_seconds: Number(stdout.trim()),
    status: "generated_unreviewed",
    patient_ready: false
  });
}

const manifest = {
  schema_version: "coach-intervention-generation/v1",
  generated_at: new Date().toISOString(),
  accepted_cap_usd: acceptedCap,
  acceptance_evidence: acceptanceEvidence,
  committed_maximum_cost_usd: exactCap,
  source_image_sha256: createHash("sha256").update(imageBytes).digest("hex"),
  records
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(JSON.stringify({ manifest: path.relative(projectRoot, manifestPath), records: records.map(({ id, output, status }) => ({ id, output, status })) }, null, 2) + "\n");
