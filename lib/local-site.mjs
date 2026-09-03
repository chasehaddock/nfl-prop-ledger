import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { ACTIVE_CAPTURE_SOURCES } from "./source-policy.mjs";
import { randomUUID } from "node:crypto";
import { calendarDateInTimeZone } from "./daily-run.mjs";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function safeFile(rootDirectory, requestUrl) {
  const pathname = decodeURIComponent(requestUrl.split(/[?#]/, 1)[0]);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(rootDirectory, relative);
  if (file !== rootDirectory && !file.startsWith(`${rootDirectory}${path.sep}`)) return null;
  return file;
}

const CAPTURE_SOURCES = new Set(ACTIVE_CAPTURE_SOURCES);
const CAPTURE_PASSES = new Set(["primary", "confirmation"]);

function extensionOrigin(request) {
  const origin = request.headers.origin || "";
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? origin : null;
}

async function readJsonBody(request, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Capture is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function saveCapture(request, response, captureRoot, captureTimeZone) {
  const origin = extensionOrigin(request);
  if (!origin || request.headers["x-nfl-prop-collector"] !== "1") {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const { pass, capture } = await readJsonBody(request);
    if (!CAPTURE_PASSES.has(pass) || !CAPTURE_SOURCES.has(capture?.source) || !Array.isArray(capture?.pages)) {
      response.writeHead(400).end("Invalid capture envelope");
      return;
    }
    const date = calendarDateInTimeZone(capture.capturedAt, captureTimeZone);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) {
      response.writeHead(400).end("Invalid capture date");
      return;
    }
    const directory = path.join(captureRoot, date);
    const filename = `${capture.source}-${pass}-raw.json`;
    const target = path.join(directory, filename);
    const temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(capture, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    response.writeHead(201, {
      "Access-Control-Allow-Origin": origin,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Vary": "Origin",
    }).end(JSON.stringify({ ok: true, filename }));
  } catch (error) {
    response.writeHead(error?.statusCode || (error instanceof SyntaxError ? 400 : 500)).end(error.message);
  }
}

export function createLocalSiteServer(rootDirectory, { captureDirectory, captureTimeZone = "America/Denver" } = {}) {
  const root = path.resolve(rootDirectory);
  const captureRoot = captureDirectory ? path.resolve(captureDirectory) : null;
  return http.createServer(async (request, response) => {
    if (request.url === "/api/capture" && request.method === "OPTIONS") {
      const origin = extensionOrigin(request);
      if (!origin) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      response.writeHead(204, {
        "Access-Control-Allow-Headers": "Content-Type, X-NFL-Prop-Collector",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
      }).end();
      return;
    }
    if (request.url === "/api/capture" && request.method === "POST") {
      if (!captureRoot) {
        response.writeHead(404).end("Capture endpoint disabled");
        return;
      }
      await saveCapture(request, response, captureRoot, captureTimeZone);
      return;
    }

    let file;
    try {
      file = safeFile(root, request.url || "/");
    } catch {
      response.writeHead(400).end("Bad request");
      return;
    }
    if (!file) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    try {
      const details = await stat(file);
      if (!details.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        response.writeHead(500).end("Local site error");
        return;
      }
      file = path.join(root, "index.html");
      try {
        await stat(file);
      } catch {
        response.writeHead(503).end("Dashboard build is missing. Run npm run build.");
        return;
      }
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(file).pipe(response);
  });
}
