// scripts/lib/build-hash.mjs
// One hash over everything the guide and the provider page serve, so a review binds to the exact build
// it saw. Receipts and the spend ledger are left out: recording a review must not change the build it
// reviewed.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export const BUILD_PATHS = Object.freeze(["guide/", "content/", "assets/audio/v2/", "assets/captions/v2/", "assets/anatomy/", "output/pdf/airline-safety-card-deck-prototype.pdf"]);
export const BUILD_EXCLUDED = Object.freeze(["content/reviews/", "content/spend/"]);

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function inBuild(path) {
  return BUILD_PATHS.some((prefix) => path.startsWith(prefix)) && !BUILD_EXCLUDED.some((prefix) => path.startsWith(prefix));
}

export function hashEntries(entries) {
  const lines = entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).sort();
  return sha256(lines.join(""));
}

// Tracked files plus new ones git does not ignore, as they are in the working tree.
export async function buildFiles(root) {
  const { stdout } = await promisify(execFile)("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(stdout.split("\0").filter(Boolean))].filter(inBuild).sort();
}

export async function buildHash(root) {
  const entries = [];
  for (const path of await buildFiles(root)) {
    const data = await readFile(join(root, path)).catch((error) => (error.code === "ENOENT" ? null : Promise.reject(error)));
    if (data) entries.push({ path, sha256: sha256(data) });
  }
  return { sha256: hashEntries(entries), files: entries.length };
}
