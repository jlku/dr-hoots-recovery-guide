import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("the TikTok page plays the complete three-part guide", async () => {
  const html = await readFile(resolve(root, "tiktok-video.html"), "utf8");
  const chapterStarts = [...html.matchAll(/data-start="([\d.]+)"/g)].map((match) => Number(match[1]));
  const video = await stat(resolve(root, "assets/video/dr-hoots-full-guide-native-paced.mp4"));

  assert.match(html, /assets\/video\/dr-hoots-full-guide-native-paced\.mp4/);
  assert.doesNotMatch(html, /assets\/video\/dr-hoots-tiktok-native\.mp4/);
  assert.deepEqual(chapterStarts, [0, 42.4, 95.12]);
  assert.match(html, /Part 1<\/span><span class="chapter-title">Care for the surgery site/);
  assert.match(html, /Part 2<\/span><span class="chapter-title">When to call/);
  assert.match(html, /Part 3<\/span><span class="chapter-title">First programming visits/);
  assert.match(html, /video\.currentTime = start/);
  assert.ok(video.size > 0, "complete TikTok video must not be empty");
});

test("the TikTok page and homepage describe the complete cut", async () => {
  const [page, homepage, readme] = await Promise.all([
    readFile(resolve(root, "tiktok-video.html"), "utf8"),
    readFile(resolve(root, "index.html"), "utf8"),
    readFile(resolve(root, "README.md"), "utf8")
  ]);

  assert.match(page, /href="index\.html#variations">← All experiments<\/a>/);
  assert.match(page, /Download complete MP4/);
  assert.match(homepage, /preview-duration">▶ 2:03<\/span>/);
  assert.match(readme, /complete three-part vertical-video experiment/i);
});
