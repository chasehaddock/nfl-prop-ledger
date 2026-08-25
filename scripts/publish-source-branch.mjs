import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [gh, repository, branch = "source"] = process.argv.slice(2);
if (!gh || !repository) throw new Error("Usage: node publish-source-branch.mjs GH OWNER/REPO [BRANCH]");

const root = process.cwd();
const rootFiles = new Set([
  ".gitignore", "README.md", "CONTINUATION_GUIDE.md", "BUDDY_CHATGPT_HANDOFF.md",
  "START-HERE-LOCAL.md", "SETUP-LINUX.sh",
  "SETUP-MAC.command", "SETUP-WINDOWS.cmd", "eslint.config.mjs", "index.html",
  "package-lock.json", "package.json", "tsconfig.json", "vite.config.ts",
]);
const sourceDirectories = ["app", "collector", "data", "extension", "lib", "public", "scripts", "src", "tests"];
const excludedPrefixes = ["data/incoming/", "public/data/.tmp/", ".private/", "raw-captures/", "node_modules/", "dist/"];
const secretPatterns = [
  /github_pat_[A-Za-z0-9_]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*["'][^"']{12,}["']/i,
];

async function apiOnce(endpoint, method = "GET", body, allowMissing = false) {
  const args = ["api", endpoint, "-X", method];
  let requestDirectory;
  try {
    if (body !== undefined) {
      requestDirectory = await mkdtemp(path.join(os.tmpdir(), "nfl-prop-ledger-source-request-"));
      const requestFile = path.join(requestDirectory, "body.json");
      await writeFile(requestFile, JSON.stringify(body));
      args.push("--input", requestFile);
    }
    const stdout = [];
    const stderr = [];
    const child = spawn(gh, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    if (allowMissing && code !== 0 && /HTTP 404/i.test(Buffer.concat(stderr).toString("utf8"))) return null;
    if (code !== 0) throw new Error(Buffer.concat(stderr).toString("utf8") || `GitHub API failed with exit code ${code}`);
    const output = Buffer.concat(stdout).toString("utf8").trim();
    return output ? JSON.parse(output) : null;
  } finally {
    if (requestDirectory) await rm(requestDirectory, { recursive: true, force: true });
  }
}

async function api(endpoint, method = "GET", body, allowMissing = false) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try { return await apiOnce(endpoint, method, body, allowMissing); }
    catch (error) {
      lastError = error;
      if (attempt === 4 || !/HTTP (408|409|429|5\d\d)/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

async function filesUnder(directory, relative = "") {
  const entries = await readdir(path.join(root, directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const nested = path.posix.join(relative, entry.name);
    const repositoryPath = path.posix.join(directory, nested);
    if (excludedPrefixes.some((prefix) => repositoryPath.startsWith(prefix))) continue;
    if (entry.isDirectory()) files.push(...await filesUnder(directory, nested));
    else if (entry.isFile()) files.push(repositoryPath);
  }
  return files;
}

const files = [...rootFiles];
for (const directory of sourceDirectories) files.push(...await filesUnder(directory));
files.sort();

for (const file of files) {
  const content = await readFile(path.join(root, file));
  if (content.includes(0)) throw new Error(`Refusing binary source file: ${file}`);
  const text = content.toString("utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) throw new Error(`Possible secret detected; refusing to publish ${file}`);
}

const mainRef = await api(`repos/${repository}/git/ref/heads/main`);
let branchRef = await api(`repos/${repository}/git/ref/heads/${branch}`, "GET", undefined, true);
if (!branchRef) {
  branchRef = await api(`repos/${repository}/git/refs`, "POST", { ref: `refs/heads/${branch}`, sha: mainRef.object.sha });
  console.log(`Created ${branch} from main.`);
}
const currentCommit = await api(`repos/${repository}/git/commits/${branchRef.object.sha}`);
const currentTree = await api(`repos/${repository}/git/trees/${currentCommit.tree.sha}?recursive=1`);
const currentBlobs = new Map((currentTree.tree || []).filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
const wanted = new Set(files);
const tree = (currentTree.tree || []).filter((entry) => entry.type === "blob" && !wanted.has(entry.path)).map((entry) => ({ path: entry.path, mode: "100644", type: "blob", sha: null }));

function blobSha(content) { return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex"); }

for (const file of files) {
  const content = await readFile(path.join(root, file));
  if (currentBlobs.get(file) === blobSha(content)) continue;
  console.log(`Uploading ${file}…`);
  const blob = await api(`repos/${repository}/git/blobs`, "POST", { content: content.toString("base64"), encoding: "base64" });
  const info = await stat(path.join(root, file));
  tree.push({ path: file, mode: info.mode & 0o111 ? "100755" : "100644", type: "blob", sha: blob.sha });
}

const createdTree = await api(`repos/${repository}/git/trees`, "POST", { base_tree: currentCommit.tree.sha, tree });
if (createdTree.sha === currentCommit.tree.sha) {
  console.log(`GitHub ${branch} already matches the sanitized source.`);
  process.exit(0);
}
const commit = await api(`repos/${repository}/git/commits`, "POST", {
  message: `Sync editable NFL Prop Ledger source ${new Date().toISOString().slice(0, 10)}`,
  tree: createdTree.sha,
  parents: [branchRef.object.sha],
});
await api(`repos/${repository}/git/refs/heads/${branch}`, "PATCH", { sha: commit.sha, force: false });
console.log(`Published ${files.length} sanitized source files to ${branch} in commit ${commit.sha.slice(0, 7)}.`);
