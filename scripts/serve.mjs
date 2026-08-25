import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const port = Number.parseInt(process.env.PORT || "4173", 10);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".wav": "audio/wav"
};

function safePath(pathname) {
  const decoded = decodeURIComponent(pathname.split("?")[0]);
  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  const candidate = resolve(join(root, relative || "index.html"));
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!match || (!match[1] && !match[2])) return null;

  const requestedStart = match[1] ? Number.parseInt(match[1], 10) : null;
  const requestedEnd = match[2] ? Number.parseInt(match[2], 10) : null;
  const start = requestedStart ?? Math.max(0, size - requestedEnd);
  const end = requestedStart === null ? size - 1 : Math.min(requestedEnd ?? size - 1, size - 1);

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
    return { invalid: true };
  }

  return { end, start };
}

const server = createServer(async (request, response) => {
  try {
    let filePath = safePath(request.url || "/");
    if (!filePath) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = join(filePath, "index.html");
    const resolvedStat = await stat(filePath);
    if (!resolvedStat.isFile()) throw new Error("Not a file");

    const contentType = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    const range = request.headers.range ? parseRange(request.headers.range, resolvedStat.size) : null;

    if (range?.invalid) {
      response.writeHead(416, {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${resolvedStat.size}`
      }).end();
      return;
    }

    if (range) {
      response.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Length": range.end - range.start + 1,
        "Content-Range": `bytes ${range.start}-${range.end}/${resolvedStat.size}`,
        "Content-Type": contentType
      });
      createReadStream(filePath, { start: range.start, end: range.end }).pipe(response);
      return;
    }

    response.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": resolvedStat.size,
      "Content-Type": contentType
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Dr. Hoots prototype: http://localhost:${port}`);
});
