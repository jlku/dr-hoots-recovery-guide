import { fal } from "@fal-ai/client";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(projectRoot, "assets", "character", "dr-hoots-motion-base-v2.png");
const outputDir = path.join(projectRoot, "assets", "video");
const outputPath = path.join(outputDir, "dr-hoots-welcome-v3.mp4");
const manifestPath = path.join(outputDir, "manifest.json");
const force = process.argv.includes("--force");

const generation = {
  id: "dr-hoots-welcome-v3",
  model: "fal-ai/kling-video/o1/standard/image-to-video",
  duration: "4",
  prompt: "Begin at @Image1 and return exactly to @Image2. This is a locked-camera clay host portrait. Animate only one small natural blink and a barely perceptible friendly head tilt. Both feathered wings remain fully tucked against the body and completely still. Keep the exact face, eyes, beak, feather texture, teal scrubs, gold pin, pockets, proportions, feet, pale-blue background, and lighting unchanged. No speech, beak movement, body gesture, waving, pointing, hands, fingers, extra limbs, morphing, eye drift, clothing drift, pin drift, or background movement."
};

if (!process.env.FAL_KEY) {
  throw new Error("FAL_KEY is missing. Add it to .env.local before generating the host video.");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to download generated video: ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

await mkdir(outputDir, { recursive: true });

if (!force && await exists(outputPath)) {
  console.log("Keeping existing Dr. Hoots host video (use --force to regenerate).");
  process.exit(0);
}

const sourceBuffer = await readFile(sourcePath);
const sourceFile = new File([sourceBuffer], path.basename(sourcePath), { type: "image/png" });
console.log("Uploading the approved Dr. Hoots motion-base still…");
const sourceUrl = await fal.storage.upload(sourceFile);

console.log("Generating the restrained Dr. Hoots welcome performance…");
const result = await fal.subscribe(generation.model, {
  input: {
    prompt: generation.prompt,
    start_image_url: sourceUrl,
    end_image_url: sourceUrl,
    duration: generation.duration
  },
  logs: true,
  onQueueUpdate(update) {
    if (update.status === "IN_PROGRESS") {
      for (const log of update.logs ?? []) console.log(`  ${log.message}`);
    }
  }
});

const videoUrl = result.data.video?.url;
if (!videoUrl) throw new Error("FAL returned no video URL.");
await download(videoUrl, outputPath);

const record = {
  ...generation,
  file: "assets/video/dr-hoots-welcome-v3.mp4",
  source: "assets/character/dr-hoots-motion-base-v2.png",
  requestId: result.requestId,
  status: "unreviewed_generation"
};

let records = [];
if (await exists(manifestPath)) {
  records = JSON.parse(await readFile(manifestPath, "utf8")).records ?? [];
  records = records.map((previous) => {
    if (previous.id === "dr-hoots-welcome-v1") return { ...previous, status: "rejected_hand_like_wing" };
    if (previous.id === "dr-hoots-welcome-v2") return { ...previous, status: "rejected_wing_drift" };
    return previous;
  });
}
records = records.filter((previous) => previous.id !== record.id);
records.push(record);
await writeFile(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`);
console.log(`Saved ${path.relative(projectRoot, outputPath)}.`);
console.log(`Wrote ${path.relative(projectRoot, manifestPath)}.`);
