import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { captureSetIsReady, findFreshCaptureSources, LEDGER_TIME_ZONE } from "../lib/operator-automation.mjs";
import { validateDailyRawPair } from "../lib/daily-run.mjs";

const exec = promisify(execFile);
const repoPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const waitMinutes = Number(process.env.NFL_PROP_CAPTURE_WAIT_MINUTES || 60);
const pollMilliseconds = Number(process.env.NFL_PROP_CAPTURE_POLL_MS || 15_000);
const settleMinutes = Number(process.env.NFL_PROP_CAPTURE_SETTLE_MINUTES || 10);
if (!Number.isFinite(waitMinutes) || waitMinutes < 0 || !Number.isFinite(pollMilliseconds) || pollMilliseconds < 100 || !Number.isFinite(settleMinutes) || settleMinutes < 0) {
  throw new Error("Automatic capture wait settings are invalid.");
}

function ledgerDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LEDGER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

async function waitForCapture() {
  const startedAt = Date.now();
  const deadline = startedAt + waitMinutes * 60_000;
  const date = ledgerDate();
  const captureDates = [...new Set([date, new Date().toISOString().slice(0, 10)])];
  let lastReport = 0;
  let lastFreshKey = "";
  let freshSetChangedAt = Date.now();
  let lastSources = [];

  while (Date.now() <= deadline) {
    const sources = await findFreshCaptureSources({
      homeDirectory: os.homedir(),
      date,
      captureDates,
      readJson,
      validatePair: validateDailyRawPair,
      rootDirectory: path.join(repoPath, ".private", "browser-captures"),
    });
    lastSources = sources;
    const freshKey = sources.join(",");
    if (freshKey !== lastFreshKey) {
      lastFreshKey = freshKey;
      freshSetChangedAt = Date.now();
    }
    if (captureSetIsReady({ freshSources: sources, unchangedForMs: Date.now() - freshSetChangedAt, settleMs: settleMinutes * 60_000 })) {
      console.log(`Fresh capture pair found for ${sources.join(", ")}.`);
      return;
    }
    if (Date.now() - lastReport >= 60_000 || lastReport === 0) {
      console.log(`Waiting for the browser capture for ${date}...`);
      lastReport = Date.now();
    }
    await sleep(pollMilliseconds);
  }
  if (lastSources.length) {
    console.warn(`Maximum wait reached; continuing with fresh pairs for ${lastSources.join(", ")}.`);
    return;
  }
  throw new Error(`No fresh browser capture pair appeared within ${waitMinutes} minutes.`);
}

async function runDaily() {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const result = await exec(process.execPath, ["scripts/run-daily.mjs"], { cwd: repoPath });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      return;
    } catch (error) {
      lastError = error;
      process.stderr.write(error?.stdout || "");
      process.stderr.write(error?.stderr || "");
      if (attempt < 5) await sleep(attempt * 5_000);
    }
  }
  throw lastError;
}

async function localOnlyMode() {
  if (process.env.NFL_PROP_LOCAL_ONLY === "1") return true;
  try {
    await access(path.join(repoPath, ".private", "operator", "local-mode"));
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await access(path.join(repoPath, ".git"));
    return false;
  } catch {
    return true;
  }
}

async function rebuildLocalSite() {
  const vite = path.join(repoPath, "node_modules", "vite", "bin", "vite.js");
  const result = await exec(process.execPath, [vite, "build"], { cwd: repoPath });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

async function publishGitHubSite() {
  if (process.env.NFL_PROP_AUTO_PUBLISH !== "1") return;
  const gh = process.env.NFL_PROP_GH_PATH;
  const repository = process.env.NFL_PROP_GITHUB_REPOSITORY;
  if (!gh || !repository) throw new Error("Automatic publishing requires NFL_PROP_GH_PATH and NFL_PROP_GITHUB_REPOSITORY.");
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "nfl-prop-ledger-pages-"));
  try {
    const vite = path.join(repoPath, "node_modules", "vite", "bin", "vite.js");
    const build = await exec(process.execPath, [vite, "build", "--outDir", outputDirectory], {
      cwd: repoPath,
      env: { ...process.env, GITHUB_ACTIONS: "true" },
    });
    process.stdout.write(build.stdout);
    process.stderr.write(build.stderr);
    const publish = await exec(process.execPath, [
      path.join(repoPath, "scripts", "publish-github-pages.mjs"),
      gh,
      outputDirectory,
      repository,
    ], { cwd: repoPath });
    process.stdout.write(publish.stdout);
    process.stderr.write(publish.stderr);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

process.chdir(repoPath);
await waitForCapture();
await runDaily();
if (await localOnlyMode()) await rebuildLocalSite();
await publishGitHubSite();
