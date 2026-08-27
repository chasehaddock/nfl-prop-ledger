import path from "node:path";

export const LEDGER_TIME_ZONE = "America/Chicago";
export const CAPTURE_SOURCES = ["draftkings", "fanduel", "prizepicks", "underdog", "sleeper"];

export function operatorId(username) {
  const id = String(username || "operator").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || "operator";
}

export function synchronizedPathRisk(repoPath) {
  const normalized = repoPath.toLowerCase().replaceAll("\\", "/");
  const markers = ["/icloud drive/", "/mobile documents/", "/onedrive/", "/dropbox/", "/google drive/", "/desktop/", "/documents/"];
  return markers.find((marker) => normalized.includes(marker)) || null;
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function macLaunchAgent({
  label,
  programArguments,
  workingDirectory,
  stdoutPath,
  stderrPath,
  hour,
  minute,
  environment = {},
  runAtLoad = false,
  keepAlive = false,
}) {
  const args = programArguments.map((argument) => `    <string>${xml(argument)}</string>`).join("\n");
  const environmentEntries = Object.entries(environment).map(([key, value]) => `    <key>${xml(key)}</key><string>${xml(value)}</string>`).join("\n");
  const environmentBlock = environmentEntries ? `  <key>EnvironmentVariables</key>\n  <dict>\n${environmentEntries}\n  </dict>\n` : "";
  const schedule = Number.isInteger(hour) && Number.isInteger(minute)
    ? `  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>\n`
    : "";
  const lifecycle = `${runAtLoad ? "  <key>RunAtLoad</key><true/>\n" : ""}${keepAlive ? "  <key>KeepAlive</key><true/>\n" : ""}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key><string>${xml(workingDirectory)}</string>
${environmentBlock}${schedule}${lifecycle}  <key>StandardOutPath</key><string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${xml(stderrPath)}</string>
</dict>
</plist>
`;
}

export function windowsRunner({ nodePath, repoPath, localOnly = false, script = "run-automatic.mjs" }) {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const environment = localOnly ? "set NFL_PROP_LOCAL_ONLY=1\r\n" : "";
  return `@echo off\r\ncd /d ${quote(repoPath)}\r\n${environment}${quote(nodePath)} ${quote(path.join(repoPath, "scripts", script))}\r\nexit /b %ERRORLEVEL%\r\n`;
}

function systemdQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function linuxService({ nodePath, repoPath, localOnly = false, script = "run-automatic.mjs", keepAlive = false }) {
  const environment = localOnly ? "Environment=NFL_PROP_LOCAL_ONLY=1\n" : "";
  const restart = keepAlive ? "Restart=on-failure\nRestartSec=5\n" : "";
  return `[Unit]
Description=NFL Prop Ledger automatic daily processor
After=network-online.target
Wants=network-online.target

[Service]
Type=${keepAlive ? "simple" : "oneshot"}
WorkingDirectory=${systemdQuote(repoPath)}
${environment}ExecStart=${systemdQuote(nodePath)} ${systemdQuote(path.join(repoPath, "scripts", script))}
${restart}

[Install]
WantedBy=default.target
`;
}

export function localOnlyRequested({ environmentValue, gitAvailable, markerAvailable }) {
  return environmentValue === "1" || markerAvailable || !gitAvailable;
}

export function linuxTimer() {
  return `[Unit]
Description=Run NFL Prop Ledger every morning

[Timer]
OnCalendar=*-*-* 08:32:00
Persistent=true
Unit=nfl-prop-ledger.service

[Install]
WantedBy=timers.target
`;
}

export function capturePaths(homeDirectory, date, source, rootDirectory) {
  const directory = path.join(rootDirectory || path.join(homeDirectory, "Downloads", "nfl-prop-ledger"), date);
  return {
    primary: path.join(directory, `${source}-primary-raw.json`),
    confirmation: path.join(directory, `${source}-confirmation-raw.json`),
  };
}

export function captureSetIsReady({ freshSources, unchangedForMs, settleMs = 10 * 60 * 1000 }) {
  if (freshSources.length === CAPTURE_SOURCES.length) return true;
  return freshSources.length > 0 && unchangedForMs >= settleMs;
}

export async function findFreshCaptureSources({ homeDirectory, date, captureDates = [date], readJson, validatePair, now = new Date(), rootDirectory }) {
  const fresh = [];
  for (const source of CAPTURE_SOURCES) {
    let valid = false;
    for (const captureDate of [...new Set(captureDates)]) {
      const files = capturePaths(homeDirectory, captureDate, source, rootDirectory);
      try {
        const [primary, confirmation] = await Promise.all([readJson(files.primary), readJson(files.confirmation)]);
        if (validatePair(primary, confirmation, { source, date, now, timeZone: LEDGER_TIME_ZONE }).length === 0) {
          valid = true;
          break;
        }
      } catch (error) {
        if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
    }
    if (valid) fresh.push(source);
  }
  return fresh;
}
