import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { retryTransient, validateDailyRawPair } from "../lib/daily-run.mjs";
import { localOnlyRequested } from "../lib/operator-automation.mjs";

const exec = promisify(execFile);
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const captureDates = [...new Set([date, new Date().toISOString().slice(0, 10)])];
const captureRoot = path.resolve(".private", "browser-captures");
const incomingDir = path.resolve("data/incoming", date);
const sourceIds = ["draftkings", "fanduel", "prizepicks", "underdog", "sleeper"];

async function exists(file) {
  try {
    await retryTransient(() => access(file));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(file) {
  return retryTransient(async () => JSON.parse(await readFile(file, "utf8")));
}

async function run(file, args, options = {}) {
  return retryTransient(() => exec(file, args, options));
}

await retryTransient(() => mkdir(incomingDir, { recursive: true }));
const captureFiles = [];
let sleeperProcessed = false;
for (const sourceId of sourceIds) {
  const candidates = [];
  let partialFound = false;
  for (const captureDate of captureDates) {
    const directory = path.join(captureRoot, captureDate);
    const primaryRaw = path.join(directory, `${sourceId}-primary-raw.json`);
    const confirmationRaw = path.join(directory, `${sourceId}-confirmation-raw.json`);
    const availability = await Promise.all([exists(primaryRaw), exists(confirmationRaw)]);
    partialFound ||= availability.some(Boolean) && !availability.every(Boolean);
    if (!availability.every(Boolean)) continue;
    const [primaryEnvelope, confirmationEnvelope] = await Promise.all([readJson(primaryRaw), readJson(confirmationRaw)]);
    const freshnessErrors = validateDailyRawPair(primaryEnvelope, confirmationEnvelope, { source: sourceId, date });
    if (!freshnessErrors.length) candidates.push({ primaryRaw, confirmationRaw, primaryEnvelope, confirmationEnvelope });
  }
  if (!candidates.length) {
    if (!partialFound) continue;
    console.warn(`${sourceId}: skipped because primary and confirmation files are not both present`);
    continue;
  }
  candidates.sort((left, right) => Date.parse(right.confirmationEnvelope.capturedAt) - Date.parse(left.confirmationEnvelope.capturedAt));
  const [{ primaryRaw, confirmationRaw }] = candidates;

  if (sourceId === "sleeper") {
    const output = path.resolve("data/sleeper-adp", `${date}.json`);
    await run(process.execPath, ["scripts/process-sleeper-adp-pair.mjs", primaryRaw, confirmationRaw, output], { cwd: process.cwd() });
    sleeperProcessed = true;
    continue;
  }

  const primary = path.join(incomingDir, `${sourceId}-primary.json`);
  const confirmation = path.join(incomingDir, `${sourceId}-confirmation.json`);
  await run(process.execPath, ["scripts/process-browser-capture.mjs", primaryRaw, primary], { cwd: process.cwd() });
  await run(process.execPath, ["scripts/process-browser-capture.mjs", confirmationRaw, confirmation], { cwd: process.cwd() });
  captureFiles.push(primary, confirmation);
}
if (captureFiles.length === 0 && !sleeperProcessed) throw new Error(`No complete browser captures found in ${captureRoot} for ${captureDates.join(" or ")}`);

if (captureFiles.length) await run(process.execPath, ["scripts/ingest-captures.mjs", ...captureFiles], { cwd: process.cwd() });
await run(process.execPath, ["scripts/build-public-data.mjs"], { cwd: process.cwd() });

const gitDir = path.resolve(".git");
const localMarker = path.resolve(".private/operator/local-mode");
const localOnly = localOnlyRequested({
  environmentValue: process.env.NFL_PROP_LOCAL_ONLY,
  gitAvailable: await exists(gitDir),
  markerAvailable: await exists(localMarker),
});
if (!localOnly) {
  await run("git", ["add", "data/snapshots", "data/rosters", "data/sleeper-adp", "public/data"], { cwd: process.cwd() });
  const { stdout } = await run("git", ["status", "--porcelain", "--", "data/snapshots", "data/rosters", "data/sleeper-adp", "public/data"], { cwd: process.cwd() });
  if (stdout.trim()) await run("git", ["commit", "-m", `data: capture ${date}`], { cwd: process.cwd() });
  const { stdout: remotes } = await run("git", ["remote"], { cwd: process.cwd() });
  if (remotes.trim()) await run("git", ["push"], { cwd: process.cwd() });
} else {
  console.log("Local-only mode: data was saved on this computer; Git commit and push were skipped.");
}
console.log(`Daily ledger complete for ${date}.`);
