import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function waitForReady(child) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("static server did not start")), 5_000);
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      if (!chunk.toString().includes("Recovery guide prototype")) return;
      clearTimeout(timeout);
      resolveReady();
    });
  });
}

test("the local server supports byte-range media seeking", async () => {
  const port = 43_000 + (process.pid % 1_000);
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);
    const videoUrl = `http://127.0.0.1:${port}/assets/audio/v2/en/incision-day2.mp3`;
    const cases = [
      { range: "bytes=0-99", status: 206, length: "100", contentRange: /^bytes 0-99\/\d+$/ },
      { range: "bytes=100-", status: 206, contentRange: /^bytes 100-\d+\/\d+$/ },
      { range: "bytes=-100", status: 206, length: "100", contentRange: /^bytes \d+-\d+\/\d+$/ },
      { range: "bytes=999999999-", status: 416, contentRange: /^bytes \*\/\d+$/ }
    ];

    for (const expected of cases) {
      const response = await fetch(videoUrl, { headers: { Range: expected.range } });
      await response.body?.cancel();
      assert.equal(response.status, expected.status, expected.range);
      assert.equal(response.headers.get("accept-ranges"), "bytes", expected.range);
      if (expected.length) assert.equal(response.headers.get("content-length"), expected.length, expected.range);
      assert.match(response.headers.get("content-range") ?? "", expected.contentRange, expected.range);
    }
  } finally {
    child.kill("SIGTERM");
  }
});
