import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findFreshCaptureSources, LEDGER_TIME_ZONE, localOnlyRequested, operatorId } from "../lib/operator-automation.mjs";
import { validateDailyRawPair } from "../lib/daily-run.mjs";

const exec = promisify(execFile);
const repoPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireToday = process.argv.includes("--require-today");
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: LEDGER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const checks = [];
const manualCapture = await exists(path.join(repoPath, ".private", "operator", "manual-capture"));

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

const localOnly = localOnlyRequested({
  environmentValue: process.env.NFL_PROP_LOCAL_ONLY,
  gitAvailable: await exists(path.join(repoPath, ".git")),
  markerAvailable: await exists(path.join(repoPath, ".private", "operator", "local-mode")),
});

function check(name, passed, detail, required = true) {
  checks.push({ name, passed, detail, required });
  console.log(`${passed ? "PASS" : required ? "FAIL" : "WARN"} ${name}: ${detail}`);
}

async function commandWorks(file, args) {
  try {
    await exec(file, args, { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

async function schedulerHealth() {
  if (manualCapture) {
    check("capture mode", true, "manual only; no daily capture schedules expected");
    if (process.platform === "darwin" && localOnly) {
      const base = `com.${operatorId(os.userInfo().username)}.nfl-prop-ledger`;
      check("private dashboard schedule", await commandWorks("launchctl", ["print", `gui/${process.getuid()}/${base}.site`]), `${base}.site`);
    } else if (process.platform === "win32" && localOnly) {
      check("private dashboard schedule", await commandWorks("schtasks.exe", ["/Query", "/TN", "NFL Prop Ledger - Site"]), "NFL Prop Ledger - Site");
    } else if (localOnly) {
      check("private dashboard schedule", await commandWorks("systemctl", ["--user", "is-enabled", "nfl-prop-ledger-site.service"]), "nfl-prop-ledger-site.service");
    }
    return;
  }
  if (process.platform === "darwin") {
    const base = `com.${operatorId(os.userInfo().username)}.nfl-prop-ledger`;
    const uid = process.getuid();
    const processor = await commandWorks("launchctl", ["print", `gui/${uid}/${base}`]);
    const chrome = await commandWorks("launchctl", ["print", `gui/${uid}/${base}.chrome`]);
    check("daily processor schedule", processor, base);
    check("Chrome opener schedule", chrome, `${base}.chrome`);
    if (localOnly) check("private dashboard schedule", await commandWorks("launchctl", ["print", `gui/${uid}/${base}.site`]), `${base}.site`);
    return;
  }
  if (process.platform === "win32") {
    check("daily processor schedule", await commandWorks("schtasks.exe", ["/Query", "/TN", "NFL Prop Ledger - Process"]), "NFL Prop Ledger - Process");
    check("Chrome opener schedule", await commandWorks("schtasks.exe", ["/Query", "/TN", "NFL Prop Ledger - Chrome"]), "NFL Prop Ledger - Chrome");
    if (localOnly) check("private dashboard schedule", await commandWorks("schtasks.exe", ["/Query", "/TN", "NFL Prop Ledger - Site"]), "NFL Prop Ledger - Site");
    return;
  }
  check("daily processor schedule", await commandWorks("systemctl", ["--user", "is-enabled", "nfl-prop-ledger.timer"]), "nfl-prop-ledger.timer");
  check("Chrome opener schedule", await commandWorks("systemctl", ["--user", "is-enabled", "nfl-prop-ledger-chrome.timer"]), "nfl-prop-ledger-chrome.timer");
  if (localOnly) check("private dashboard schedule", await commandWorks("systemctl", ["--user", "is-enabled", "nfl-prop-ledger-site.service"]), "nfl-prop-ledger-site.service");
}

await schedulerHealth();

const current = JSON.parse(await readFile(path.join(repoPath, "public", "data", "current.json"), "utf8"));
const snapshotValid = Boolean(current.date) && Array.isArray(current.observations) && current.observations.length > 0;
check("published snapshot", snapshotValid && (!requireToday || current.date === today), `${current.date}; ${current.observations?.length || 0} observations`);
for (const run of current.sourceRuns || []) {
  check(`${run.source} snapshot status`, run.status === "accepted", `${run.status}; ${run.observationCount || 0} observations`, false);
}

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const freshSources = await findFreshCaptureSources({
  homeDirectory: os.homedir(),
  date: today,
  readJson,
  validatePair: validateDailyRawPair,
  rootDirectory: path.join(repoPath, ".private", "browser-captures"),
});
check("today's raw evidence", freshSources.length > 0, freshSources.length ? `fresh pairs: ${freshSources.join(", ")}` : "no fresh pair yet", requireToday);

if (localOnly) {
  check("GitHub disabled", true, "all code and history stay on this computer");
  try {
    const response = await fetch("http://127.0.0.1:4173/data/current.json");
    const served = await response.json();
    check("private dashboard", response.ok && served.date === current.date, `http://127.0.0.1:4173/ serving ${served.date}`);
  } catch (error) {
    check("private dashboard", false, error.message);
  }
} else {
  try {
    const { stdout } = await exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd: repoPath });
    const [ahead, behind] = stdout.trim().split(/\s+/).map(Number);
    check("Git synchronization", ahead === 0 && behind === 0, `ahead ${ahead}, behind ${behind}`);
  } catch (error) {
    check("Git synchronization", false, error.message);
  }
}

const failures = checks.filter((item) => item.required && !item.passed);
console.log(`\n${failures.length ? "Operator needs attention" : "Operator automation is healthy"}. Mode: ${localOnly ? "local only" : "GitHub-backed"}; ledger timezone: ${LEDGER_TIME_ZONE}.`);
if (failures.length) process.exitCode = 1;
