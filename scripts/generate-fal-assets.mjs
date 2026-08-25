import { fal } from "@fal-ai/client";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(projectRoot, "assets", "dr-hoots-clay.png");
const outputDir = path.join(projectRoot, "assets", "fal");
const manifestPath = path.join(outputDir, "manifest.json");
const force = process.argv.includes("--force");
const onlyArgument = process.argv.find(argument => argument.startsWith("--only="));
const selectedIds = onlyArgument ? new Set(onlyArgument.split("=")[1].split(",")) : null;

if (!process.env.FAL_KEY) {
  throw new Error("FAL_KEY is missing. Add it to .env.local before generating assets.");
}

const assets = [
  {
    id: "orientation",
    file: "dr-hoots-orientation.png",
    model: "fal-ai/flux-2/edit",
    seed: 48117,
    prompt: "Keep the owl's exact face, body, feather texture, teal scrub top, and gold pin. Repose the same clay character waist-up, centered, facing camera, gently presenting a small blank navy card with three connected yellow dots. Pale-blue studio background. No text, logos, medical tools, or extra limbs."
  },
  {
    id: "showering",
    file: "dr-hoots-showering.png",
    model: "fal-ai/flux-2/edit",
    seed: 48129,
    prompt: "Keep the owl's exact face, body, feather texture, teal scrub top, and gold pin. Repose the same clay character waist-up holding a small navy umbrella; three water drops fall beside, not onto, the head. Pale-blue studio background. No stethoscope, buttons, text, logos, or extra limbs."
  },
  {
    id: "activation",
    file: "dr-hoots-activation.png",
    model: "fal-ai/flux-2/edit",
    seed: 48143,
    prompt: "Keep the owl's exact face, body, feather texture, teal scrub top, and gold pin. Repose the same clay character waist-up holding a blank white clay calendar with four raised squares and one navy sound-wave symbol. Deep-navy studio background. No text, logos, medical devices, or extra limbs."
  }
];

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
  if (!response.ok) throw new Error(`Unable to download ${url}: ${response.status}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

await mkdir(outputDir, { recursive: true });

const sourceBuffer = await readFile(sourcePath);
const sourceFile = new File([sourceBuffer], path.basename(sourcePath), { type: "image/png" });
console.log("Uploading the Dr. Hoots reference image…");
const subjectUrl = await fal.storage.upload(sourceFile);

let records = [];
if (await exists(manifestPath)) {
  const previousManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  records = previousManifest.records ?? [];
}

const selectedAssets = selectedIds ? assets.filter(asset => selectedIds.has(asset.id)) : assets;
if (selectedAssets.length === 0) throw new Error("No matching assets were selected.");

for (const asset of selectedAssets) {
  const destination = path.join(outputDir, asset.file);
  if (!force && await exists(destination)) {
    console.log(`Keeping existing ${asset.file} (use --force to regenerate).`);
    continue;
  }

  console.log(`Generating ${asset.id} pose…`);
  const input = asset.model === "fal-ai/flux-2/edit" ? {
    prompt: asset.prompt,
    image_urls: [subjectUrl],
    image_size: "square_hd",
    num_inference_steps: 28,
    guidance_scale: 2.5,
    seed: asset.seed,
    num_images: 1,
    acceleration: "regular",
    enable_prompt_expansion: false,
    enable_safety_checker: true,
    output_format: "png"
  } : {
    prompt: asset.prompt,
    image_url: subjectUrl,
    image_size: "square_hd",
    num_inference_steps: 8,
    guidance_scale: 3.5,
    seed: asset.seed,
    num_images: 1,
    enable_safety_checker: true,
    output_format: "png"
  };

  const result = await fal.subscribe(asset.model, {
    input,
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_PROGRESS") {
        for (const log of update.logs ?? []) console.log(`  ${log.message}`);
      }
    }
  });

  const image = result.data.images?.[0];
  if (!image?.url) throw new Error(`No image returned for ${asset.id}.`);
  await download(image.url, destination);
  records = records.filter(record => record.id !== asset.id);
  records.push({
    id: asset.id,
    file: `assets/fal/${asset.file}`,
    model: asset.model,
    requestId: result.requestId,
    seed: result.data.seed ?? asset.seed,
    width: image.width,
    height: image.height,
    prompt: asset.prompt,
    source: "assets/dr-hoots-clay.png",
    status: "unreviewed_generation"
  });
  console.log(`Saved ${asset.file}.`);
}

await writeFile(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2)}\n`);
console.log(`Wrote ${path.relative(projectRoot, manifestPath)}.`);
