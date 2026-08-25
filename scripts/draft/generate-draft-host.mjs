// Draft-phase host performances from the canon motion base (both wings visible,
// cropped from the approved turnaround). Regenerates welcome/healing/follow-up
// speaking clips for the v1.1 animatic. Draft provenance only — the gated
// pipeline re-generates with receipts at graduation. Never touches .production/.
import { fal } from "@fal-ai/client";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODEL_ID = "fal-ai/kling-video/ai-avatar/v2/standard";
const IMAGE_PATH = "assets/character/dr-hoots-motion-base-v3-canon.png";
const MANIFEST_PATH = path.join(projectRoot, "assets", "video", "draft-manifest.json");
const OUT_DIR = path.join(projectRoot, "preview", "assets", "media");

if (!process.env.FAL_KEY) throw new Error("FAL_KEY is missing. Run with --env-file=.env.local.");

const WING_RULE =
  "Both wings stay visible, resting at the sides of the body exactly as in the source image, matching the approved turnaround. ";
const CLEAN_FRAME_RULE =
  "Absolutely no text, subtitles, captions, letters, numbers, watermarks, logos, hearts, sparkles, or decorative shapes anywhere in the frame at any time. ";

const PERFORMANCES = {
  welcome: {
    audio: "assets/audio/draft/welcome-ci.mp3",
    out: "host-welcome-canon.mp4",
    prompt:
      "Locked camera. Dr. Hoots, the same clay owl in teal scrubs, speaks the supplied narration with clear restrained beak movement, subtle natural head motion, and a warm attentive expression. " +
      WING_RULE +
      CLEAN_FRAME_RULE +
      "No gestures. Preserve the exact eyes, beak, feathers, proportions, scrubs, pin, pockets, feet, pale blue background, framing, and lighting. No pointing, ear touching, device touching, clinical demonstration, waving, extra limbs, hands, morphing, camera motion, text, or background motion."
  },
  healing: {
    audio: "assets/audio/healing.mp3",
    out: "host-healing-canon.mp4",
    prompt:
      "Locked camera. Dr. Hoots, the same clay owl in teal scrubs, speaks the supplied narration with clear restrained beak movement and a friendly attentive expression. Use one brief welcoming wing opening near the start, then settle both wings back to rest at the sides. " +
      WING_RULE +
      CLEAN_FRAME_RULE +
      "Preserve the exact eyes, beak, feathers, proportions, scrubs, pin, pockets, feet, pale blue background, framing, and lighting. No pointing, ear touching, device touching, clinical demonstration, repeated waving, extra limbs, hands, morphing, camera motion, text, or background motion."
  },
  "follow-up": {
    audio: "assets/audio/follow-up.mp3",
    out: "host-follow-up-canon.mp4",
    prompt:
      "Locked camera. Dr. Hoots, the same clay owl in teal scrubs, speaks the supplied narration with clear restrained beak movement, subtle natural head motion, and a calm attentive expression. Use one small invitation wing opening only near the words keep returning: the wing tips open slightly outward at waist height, never rising above the chest and never approaching the face or beak, then settle both wings back to rest at the sides. " +
      WING_RULE +
      CLEAN_FRAME_RULE +
      "Preserve the exact eyes, beak, feathers, proportions, scrubs, pin, pockets, feet, pale blue background, framing, and lighting. No pointing, ear touching, device touching, clinical demonstration, repeated waving, extra limbs, hands, morphing, camera motion, text, or background motion."
  }
};

const requested = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const targets = requested.length ? requested : Object.keys(PERFORMANCES);
const force = process.argv.includes("--force");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

let manifest = { generatedAt: null, records: [] };
if (await exists(MANIFEST_PATH)) manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));

await mkdir(OUT_DIR, { recursive: true });

for (const name of targets) {
  const spec = PERFORMANCES[name];
  if (!spec) throw new Error("unknown performance: " + name);
  const outPath = path.join(OUT_DIR, spec.out);
  if (!force && (await exists(outPath)) && manifest.records.some((r) => r.id === name && r.status !== "rejected")) {
    console.log(`Keeping existing ${spec.out} (use --force to regenerate).`);
    continue;
  }

  console.log(`Uploading inputs for ${name}…`);
  const imageBytes = await readFile(path.join(projectRoot, IMAGE_PATH));
  const audioBytes = await readFile(path.join(projectRoot, spec.audio));
  const imageFile = new File([imageBytes], "dr-hoots-motion-base-v3-canon.png", { type: "image/png" });
  const audioFile = new File([audioBytes], path.basename(spec.audio), { type: "audio/mpeg" });
  const [imageUrl, audioUrl] = await Promise.all([
    fal.storage.upload(imageFile),
    fal.storage.upload(audioFile)
  ]);

  console.log(`Generating ${name} performance (this takes a few minutes)…`);
  const result = await fal.subscribe(MODEL_ID, {
    input: { image_url: imageUrl, audio_url: audioUrl, prompt: spec.prompt }
  });

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) throw new Error(`FAL returned no video URL for ${name}: ${JSON.stringify(result.data)?.slice(0, 300)}`);
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()));

  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outPath]);
  const duration = Number(stdout.trim());

  const sheet = outPath.replace(/\.mp4$/, "-contact-sheet.png");
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-i", outPath, "-vf", "select='not(mod(n\\,24))',scale=300:-1,tile=8x2", "-frames:v", "1", sheet]);

  manifest.records = manifest.records.filter((r) => r.id !== name);
  manifest.records.push({
    id: name,
    file: `preview/assets/media/${spec.out}`,
    model: MODEL_ID,
    source_image: IMAGE_PATH,
    source_image_note: "canon base cropped from approved turnaround v1 front view — both wings at rest",
    audio: spec.audio,
    prompt: spec.prompt,
    requestId: result.requestId,
    duration_seconds: duration,
    status: "generated_unreviewed",
    stage: "draft_preview_only"
  });
  console.log(`Saved ${spec.out} (${duration.toFixed(2)}s).`);
}

manifest.generatedAt = new Date().toISOString();
await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
console.log("Wrote assets/video/draft-manifest.json");
