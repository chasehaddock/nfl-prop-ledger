import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalSiteServer } from "../lib/local-site.mjs";

test("serves the built dashboard and data only through the local HTTP server", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nfl-prop-local-site-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "index.html"), "<h1>Prop Ledger</h1>");
  await writeFile(path.join(root, "data", "current.json"), '{"date":"2026-08-22"}');
  const server = createLocalSiteServer(root);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Prop Ledger/);
  assert.equal(index.headers.get("cache-control"), "no-store");

  const data = await fetch(`http://127.0.0.1:${port}/data/current.json`);
  assert.deepEqual(await data.json(), { date: "2026-08-22" });

  const fallback = await fetch(`http://127.0.0.1:${port}/players/example`);
  assert.match(await fallback.text(), /Prop Ledger/);
});

test("rejects encoded path traversal", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nfl-prop-local-site-"));
  await writeFile(path.join(root, "index.html"), "safe");
  const server = createLocalSiteServer(root);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
  assert.equal(response.status, 403);
});

test("accepts extension captures into private local storage and rejects web origins", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nfl-prop-local-site-"));
  const captures = await mkdtemp(path.join(os.tmpdir(), "nfl-prop-captures-"));
  await writeFile(path.join(root, "index.html"), "safe");
  const server = createLocalSiteServer(root, { captureDirectory: captures });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const payload = {
    pass: "primary",
    capture: { source: "prizepicks", capturedAt: "2026-08-23T14:17:00.000Z", pages: [{ id: "props", rows: [{}] }] },
  };

  const denied = await fetch(`http://127.0.0.1:${port}/api/capture`, {
    method: "POST",
    headers: { Origin: "https://example.com", "X-NFL-Prop-Collector": "1", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(denied.status, 403);

  const preflight = await fetch(`http://127.0.0.1:${port}/api/capture`, {
    method: "OPTIONS",
    headers: {
      Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-nfl-prop-collector",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");

  const accepted = await fetch(`http://127.0.0.1:${port}/api/capture`, {
    method: "POST",
    headers: { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "X-NFL-Prop-Collector": "1", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(accepted.status, 201);
  const saved = JSON.parse(await readFile(path.join(captures, "2026-08-23", "prizepicks-primary-raw.json"), "utf8"));
  assert.equal(saved.source, "prizepicks");

  const removedSource = await fetch(`http://127.0.0.1:${port}/api/capture`, {
    method: "POST",
    headers: { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "X-NFL-Prop-Collector": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, capture: { ...payload.capture, source: "draftkings" } }),
  });
  assert.equal(removedSource.status, 400);
});

test("stores an after-midnight UTC capture under its ledger calendar date", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nfl-prop-local-site-"));
  const captures = await mkdtemp(path.join(os.tmpdir(), "nfl-prop-captures-"));
  await writeFile(path.join(root, "index.html"), "safe");
  const server = createLocalSiteServer(root, { captureDirectory: captures });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/capture`, {
    method: "POST",
    headers: { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "X-NFL-Prop-Collector": "1", "Content-Type": "application/json" },
    body: JSON.stringify({
      pass: "primary",
      capture: { source: "prizepicks", capturedAt: "2026-08-24T02:38:00.000Z", pages: [{ id: "props", rows: [{}] }] },
    }),
  });
  assert.equal(response.status, 201);
  const saved = JSON.parse(await readFile(path.join(captures, "2026-08-23", "prizepicks-primary-raw.json"), "utf8"));
  assert.equal(saved.source, "prizepicks");
});
