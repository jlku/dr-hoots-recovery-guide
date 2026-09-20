// scripts/lib/serve-build.mjs
// Serves the repository with scripts/serve.mjs on a free local port, for scripts that drive a browser.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

export async function serveBuild(root, probe = "/guide/index.html") {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/serve.mjs"], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await fetch(`${base}${probe}`).then((response) => response.ok, () => false)) return { base, stop: () => child.kill() };
    await new Promise((wait) => setTimeout(wait, 100));
  }
  child.kill();
  throw new Error("the static server did not start");
}
