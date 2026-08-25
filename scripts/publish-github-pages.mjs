import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [gh, directory, repository] = process.argv.slice(2);
if (!gh || !directory || !repository) {
  throw new Error("Usage: node publish-github-pages.mjs GH DIRECTORY OWNER/REPO");
}

async function apiOnce(endpoint, method = "GET", body) {
  const args = ["api", endpoint, "-X", method];
  let requestDirectory;
  try {
    if (body !== undefined) {
      requestDirectory = await mkdtemp(path.join(os.tmpdir(), "nfl-prop-ledger-github-request-"));
      const requestFile = path.join(requestDirectory, "body.json");
      await writeFile(requestFile, JSON.stringify(body));
      args.push("--input", requestFile);
    }
    const stdout = [];
    const stderr = [];
    const child = spawn(gh, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 60_000);
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    clearTimeout(timeout);
    if (timedOut) throw new Error("GitHub API request timed out (HTTP 408)");
    if (code !== 0) throw new Error(Buffer.concat(stderr).toString("utf8") || `GitHub API failed with exit code ${code}`);
    const output = Buffer.concat(stdout).toString("utf8").trim();
    return output ? JSON.parse(output) : null;
  } finally {
    if (requestDirectory) await rm(requestDirectory, { recursive: true, force: true });
  }
}

async function api(endpoint, method = "GET", body) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await apiOnce(endpoint, method, body);
    } catch (error) {
      lastError = error;
      if (attempt === 4 || !/HTTP (400|408|409|429|5\d\d)/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

function gitBlobSha(content) {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

async function filesUnder(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}

const files = await filesUnder(directory);
const publishedPaths = new Set(files);
const currentRef = await api(`repos/${repository}/git/ref/heads/main`);
const currentCommit = await api(`repos/${repository}/git/commits/${currentRef.object.sha}`);
const currentTree = await api(`repos/${repository}/git/trees/${currentCommit.tree.sha}?recursive=1`);
const currentBlobs = new Map((currentTree.tree || []).filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
const tree = (currentTree.tree || [])
  .filter((entry) => entry.type === "blob" && entry.path.startsWith("assets/") && !publishedPaths.has(entry.path))
  .map((entry) => ({ path: entry.path, mode: "100644", type: "blob", sha: null }));

for (const file of files) {
  const content = await readFile(path.join(directory, file));
  if (currentBlobs.get(file) === gitBlobSha(content)) continue;
  console.log(`Uploading ${file}…`);
  const blob = await api(`repos/${repository}/git/blobs`, "POST", {
    content: content.toString("base64"),
    encoding: "base64",
  });
  tree.push({ path: file, mode: "100644", type: "blob", sha: blob.sha });
}

const createdTree = await api(`repos/${repository}/git/trees`, "POST", {
  base_tree: currentCommit.tree.sha,
  tree,
});
if (createdTree.sha === currentCommit.tree.sha) {
  console.log("GitHub Pages already matches the verified build.");
  process.exit(0);
}

const commit = await api(`repos/${repository}/git/commits`, "POST", {
  message: `Publish NFL Prop Ledger ${new Date().toISOString().slice(0, 10)}`,
  tree: createdTree.sha,
  parents: [currentRef.object.sha],
});
await api(`repos/${repository}/git/refs/heads/main`, "PATCH", { sha: commit.sha, force: false });
console.log(`Published ${files.length} files in commit ${commit.sha.slice(0, 7)}.`);
