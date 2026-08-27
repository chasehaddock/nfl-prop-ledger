import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  LEDGER_TIME_ZONE,
  linuxService,
  linuxTimer,
  macLaunchAgent,
  operatorId,
  synchronizedPathRisk,
  windowsRunner,
} from "../lib/operator-automation.mjs";

const exec = promisify(execFile);
const repoPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homeDirectory = os.homedir();
const username = os.userInfo().username;
const id = operatorId(username);
const dryRun = process.argv.includes("--dry-run");
const automatic = process.argv.includes("--automatic");
const localOnly = process.argv.includes("--local") || !(await fileExists(path.join(repoPath, ".git")));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function command(file, args, options = {}) {
  if (dryRun) {
    console.log(`[dry-run] ${file} ${args.join(" ")}`);
    return Promise.resolve({ stdout: "", stderr: "" });
  }
  return exec(file, args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024, ...options });
}

async function write(target, contents, mode) {
  if (dryRun) {
    console.log(`[dry-run] write ${target}`);
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
  if (mode) await chmod(target, mode);
}

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function requireCleanRepository() {
  const { stdout } = await exec("git", ["status", "--porcelain"], { cwd: repoPath });
  if (stdout.trim()) throw new Error("The repository has uncommitted changes. Commit or resolve them before installing automation.");
  await exec("git", ["remote", "get-url", "origin"], { cwd: repoPath });
}

async function validateNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error(`Node ${process.versions.node} is too old; install Node 22.13 or newer.`);
}

async function installMac() {
  const uid = process.getuid();
  const agentDirectory = path.join(homeDirectory, "Library", "LaunchAgents");
  const logDirectory = path.join(homeDirectory, "Library", "Logs");
  const processorLabel = `com.${id}.nfl-prop-ledger`;
  const chromeLabel = `${processorLabel}.chrome`;
  const siteLabel = `${processorLabel}.site`;
  const processorFile = path.join(agentDirectory, `${processorLabel}.plist`);
  const chromeFile = path.join(agentDirectory, `${chromeLabel}.plist`);
  const siteFile = path.join(agentDirectory, `${siteLabel}.plist`);
  const processorEnvironment = localOnly ? { NFL_PROP_LOCAL_ONLY: "1" } : {};
  for (const key of ["NFL_PROP_AUTO_PUBLISH", "NFL_PROP_GH_PATH", "NFL_PROP_GITHUB_REPOSITORY"]) {
    if (process.env[key]) processorEnvironment[key] = process.env[key];
  }

  const agents = [];
  if (automatic) {
    await write(processorFile, macLaunchAgent({
      label: processorLabel,
      programArguments: [process.execPath, path.join(repoPath, "scripts", "run-automatic.mjs")],
      workingDirectory: repoPath,
      stdoutPath: path.join(logDirectory, "nfl-prop-ledger.log"),
      stderrPath: path.join(logDirectory, "nfl-prop-ledger-error.log"),
      hour: 8,
      minute: 32,
      environment: processorEnvironment,
    }));
    await write(chromeFile, macLaunchAgent({
      label: chromeLabel,
      programArguments: ["/usr/bin/open", "-a", "Google Chrome"],
      workingDirectory: homeDirectory,
      stdoutPath: path.join(logDirectory, "nfl-prop-ledger-chrome.log"),
      stderrPath: path.join(logDirectory, "nfl-prop-ledger-chrome-error.log"),
      hour: 8,
      minute: 10,
    }));
    agents.push([processorLabel, processorFile], [chromeLabel, chromeFile]);
  } else {
    for (const label of [processorLabel, chromeLabel]) {
      await command("launchctl", ["bootout", `gui/${uid}/${label}`]).catch(() => {});
      await command("launchctl", ["disable", `gui/${uid}/${label}`]).catch(() => {});
    }
  }
  if (localOnly) {
    await write(siteFile, macLaunchAgent({
      label: siteLabel,
      programArguments: [process.execPath, path.join(repoPath, "scripts", "serve-local.mjs")],
      workingDirectory: repoPath,
      stdoutPath: path.join(logDirectory, "nfl-prop-ledger-site.log"),
      stderrPath: path.join(logDirectory, "nfl-prop-ledger-site-error.log"),
      runAtLoad: true,
      keepAlive: true,
      environment: { NFL_PROP_LOCAL_ONLY: "1" },
    }));
    agents.push([siteLabel, siteFile]);
  }

  for (const [label, file] of agents) {
    await command("plutil", ["-lint", file]);
    await command("launchctl", ["bootout", `gui/${uid}/${label}`]).catch(() => {});
    await command("launchctl", ["enable", `gui/${uid}/${label}`]).catch(() => {});
    await command("launchctl", ["bootstrap", `gui/${uid}`, file]);
  }
  if (!dryRun) {
    spawn("/usr/bin/open", ["-a", "Google Chrome", "chrome://extensions"], { detached: true, stdio: "ignore" }).unref();
    spawn("/usr/bin/open", ["-R", path.join(repoPath, "extension")], { detached: true, stdio: "ignore" }).unref();
  }
  return { processorLabel, chromeLabel, siteLabel: localOnly ? siteLabel : null };
}

async function installWindows() {
  const privateDirectory = path.join(repoPath, ".private", "operator");
  const runner = path.join(privateDirectory, "run-automatic.cmd");
  if (!automatic) {
    await command("schtasks.exe", ["/Delete", "/TN", "NFL Prop Ledger - Chrome", "/F"]).catch(() => {});
    await command("schtasks.exe", ["/Delete", "/TN", "NFL Prop Ledger - Process", "/F"]).catch(() => {});
  }
  const chromeCandidates = [
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  let chromePath;
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate);
      chromePath = candidate;
      break;
    } catch {
      continue;
    }
  }
  if (!chromePath) throw new Error("Google Chrome was not found in a standard Windows installation path.");
  const chromeRunner = path.join(privateDirectory, "open-chrome.cmd");
  if (automatic) {
    await write(runner, windowsRunner({ nodePath: process.execPath, repoPath, localOnly }));
    await write(chromeRunner, `@echo off\r\nstart "" "${chromePath}"\r\n`);
    await command("schtasks.exe", ["/Create", "/TN", "NFL Prop Ledger - Chrome", "/SC", "DAILY", "/ST", "08:10", "/TR", `"${chromeRunner}"`, "/F"]);
    await command("schtasks.exe", ["/Create", "/TN", "NFL Prop Ledger - Process", "/SC", "DAILY", "/ST", "08:32", "/TR", `"${runner}"`, "/F"]);
  }
  let siteLabel = null;
  if (localOnly) {
    const siteRunner = path.join(privateDirectory, "serve-local.cmd");
    await write(siteRunner, windowsRunner({ nodePath: process.execPath, repoPath, localOnly: true, script: "serve-local.mjs" }));
    siteLabel = "NFL Prop Ledger - Site";
    await command("schtasks.exe", ["/Create", "/TN", siteLabel, "/SC", "ONLOGON", "/TR", `"${siteRunner}"`, "/F"]);
    if (!dryRun) spawn("cmd.exe", ["/c", siteRunner], { detached: true, stdio: "ignore" }).unref();
  }
  if (!dryRun) spawn(chromePath, ["chrome://extensions"], { detached: true, stdio: "ignore" }).unref();
  return { processorLabel: "NFL Prop Ledger - Process", chromeLabel: "NFL Prop Ledger - Chrome", siteLabel };
}

async function findLinuxChrome() {
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      const { stdout } = await exec("sh", ["-lc", `command -v ${name}`]);
      if (stdout.trim()) return stdout.trim();
    } catch {
      continue;
    }
  }
  throw new Error("Google Chrome or Chromium was not found on PATH.");
}

async function installLinux() {
  const unitDirectory = path.join(homeDirectory, ".config", "systemd", "user");
  const chromePath = await findLinuxChrome();
  const processorService = path.join(unitDirectory, "nfl-prop-ledger.service");
  const processorTimer = path.join(unitDirectory, "nfl-prop-ledger.timer");
  const chromeService = path.join(unitDirectory, "nfl-prop-ledger-chrome.service");
  const chromeTimer = path.join(unitDirectory, "nfl-prop-ledger-chrome.timer");
  if (automatic) {
    await write(processorService, linuxService({ nodePath: process.execPath, repoPath, localOnly }));
    await write(processorTimer, linuxTimer());
    await write(chromeService, `[Unit]\nDescription=Open Chrome for NFL Prop Ledger\n\n[Service]\nType=oneshot\nExecStart="${chromePath}" "about:blank"\n`);
    await write(chromeTimer, `[Unit]\nDescription=Open Chrome before NFL Prop Ledger capture\n\n[Timer]\nOnCalendar=*-*-* 08:10:00\nPersistent=true\nUnit=nfl-prop-ledger-chrome.service\n\n[Install]\nWantedBy=timers.target\n`);
    await command("systemctl", ["--user", "daemon-reload"]);
    await command("systemctl", ["--user", "enable", "--now", "nfl-prop-ledger.timer", "nfl-prop-ledger-chrome.timer"]);
  } else {
    await command("systemctl", ["--user", "disable", "--now", "nfl-prop-ledger.timer", "nfl-prop-ledger-chrome.timer"]).catch(() => {});
  }
  let siteLabel = null;
  if (localOnly) {
    siteLabel = "nfl-prop-ledger-site.service";
    await write(path.join(unitDirectory, siteLabel), linuxService({ nodePath: process.execPath, repoPath, localOnly: true, script: "serve-local.mjs", keepAlive: true }));
    await command("systemctl", ["--user", "daemon-reload"]);
    await command("systemctl", ["--user", "enable", "--now", siteLabel]);
  }
  if (!dryRun) spawn(chromePath, ["chrome://extensions"], { detached: true, stdio: "ignore" }).unref();
  return { processorLabel: "nfl-prop-ledger.timer", chromeLabel: "nfl-prop-ledger-chrome.timer", siteLabel };
}

await validateNode();
const syncRisk = synchronizedPathRisk(repoPath);
if (syncRisk && !dryRun) throw new Error(`Move the repository out of this potentially synchronized path before installing: ${repoPath}`);
if (syncRisk) console.warn(`[dry-run] production installation would reject the potentially synchronized path: ${repoPath}`);
if (!localOnly && dryRun) await exec("git", ["remote", "get-url", "origin"], { cwd: repoPath });
else if (!localOnly) await requireCleanRepository();

console.log(`Installing from ${repoPath}`);
console.log(`Computer timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}; ledger timezone: ${LEDGER_TIME_ZONE}`);
console.log(`Storage mode: ${localOnly ? "local only; no GitHub required" : "GitHub-backed"}`);
await command(npmCommand, ["ci"]);
await command(npmCommand, ["run", "typecheck"]);
await command(npmCommand, ["run", "lint"]);
await command(npmCommand, ["test"]);
if (localOnly) await write(path.join(repoPath, ".private", "operator", "local-mode"), "local-only\n");
const manualMarker = path.join(repoPath, ".private", "operator", "manual-capture");
if (automatic) {
  if (!dryRun) await rm(manualMarker, { force: true });
} else {
  await write(manualMarker, "manual-only\n");
}

const installed = process.platform === "darwin"
  ? await installMac()
  : process.platform === "win32"
    ? await installWindows()
    : await installLinux();

console.log(`\n${dryRun ? "Operator preview complete" : "Operator setup installed"}.`);
if (automatic) {
  console.log(`Chrome opener: ${installed.chromeLabel} at 8:10 AM local time`);
  console.log(`Daily processor: ${installed.processorLabel} at 8:32 AM local time`);
} else {
  console.log("Capture mode: manual only; no Chrome opener or daily processor schedule");
}
if (installed.siteLabel) console.log(`Private dashboard server: ${installed.siteLabel} at http://127.0.0.1:4173/`);
if (automatic) console.log("The processor waits up to 30 minutes for a manually initiated fresh capture. Use --automatic only on a machine that will be awake and attended.");
console.log("\nOne security-controlled step remains: in chrome://extensions, enable Developer mode and Load unpacked from:");
console.log(path.join(repoPath, "extension"));
console.log("Then open each configured sportsbook once, approve any legitimate browser/location prompt, and click Capture now for the acceptance test.");
if (localOnly && !dryRun) {
  await new Promise((resolve) => setTimeout(resolve, 750));
  const opener = process.platform === "darwin" ? "/usr/bin/open" : process.platform === "win32" ? "cmd.exe" : "xdg-open";
  const args = process.platform === "darwin" ? ["http://127.0.0.1:4173/"] : process.platform === "win32" ? ["/c", "start", "", "http://127.0.0.1:4173/"] : ["http://127.0.0.1:4173/"];
  spawn(opener, args, { detached: true, stdio: "ignore" }).unref();
}
