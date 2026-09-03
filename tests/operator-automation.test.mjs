import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  captureSetIsReady,
  capturePaths,
  findFreshCaptureSources,
  linuxService,
  linuxTimer,
  localOnlyRequested,
  macLaunchAgent,
  operatorId,
  synchronizedPathRisk,
  windowsRunner,
} from "../lib/operator-automation.mjs";

test("creates a safe operator id and detects synchronized repository paths", () => {
  assert.equal(operatorId("Cody O'Stler"), "cody-o-stler");
  assert.equal(operatorId("___"), "operator");
  assert.equal(synchronizedPathRisk("/Users/friend/Developer/nfl-prop-ledger"), null);
  assert.equal(synchronizedPathRisk("/Users/friend/Desktop/nfl-prop-ledger"), "/desktop/");
  assert.equal(synchronizedPathRisk("/Users/friend/Library/Mobile Documents/project"), "/mobile documents/");
  assert.equal(synchronizedPathRisk("C:\\Users\\friend\\OneDrive\\project"), "/onedrive/");
});

test("renders a machine-specific macOS LaunchAgent with escaped paths and schedule", () => {
  const plist = macLaunchAgent({
    label: "com.friend.nfl-prop-ledger",
    programArguments: ["/opt/node", "/Users/Friend & Co/repo/scripts/run-automatic.mjs"],
    workingDirectory: "/Users/Friend & Co/repo",
    stdoutPath: "/tmp/out.log",
    stderrPath: "/tmp/error.log",
    hour: 8,
    minute: 32,
  });
  assert.match(plist, /com\.friend\.nfl-prop-ledger/);
  assert.match(plist, /Friend &amp; Co/);
  assert.match(plist, /<key>Hour<\/key><integer>8<\/integer>/);
  assert.match(plist, /<key>Minute<\/key><integer>32<\/integer>/);
});

test("renders a persistent local-only macOS site agent", () => {
  const plist = macLaunchAgent({
    label: "com.friend.nfl-prop-ledger.site",
    programArguments: ["/opt/node", "/repo/scripts/serve-local.mjs"],
    workingDirectory: "/repo",
    stdoutPath: "/tmp/out.log",
    stderrPath: "/tmp/error.log",
    environment: { NFL_PROP_LOCAL_ONLY: "1" },
    runAtLoad: true,
    keepAlive: true,
  });
  assert.match(plist, /<key>NFL_PROP_LOCAL_ONLY<\/key><string>1<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.doesNotMatch(plist, /StartCalendarInterval/);
});

test("operator installation defaults to manual capture with automatic scheduling opt-in", async () => {
  const installer = await readFile(new URL("../scripts/install-operator.mjs", import.meta.url), "utf8");
  assert.match(installer, /const automatic = process\.argv\.includes\("--automatic"\)/);
  assert.match(installer, /manual-capture/);
  assert.match(installer, /launchctl", \["disable"/);
  assert.doesNotMatch(installer, /push", \["--dry-run"/);
});

test("renders Windows and Linux runners with absolute machine paths", () => {
  const windows = windowsRunner({ nodePath: "C:\\Program Files\\nodejs\\node.exe", repoPath: "C:\\Users\\friend\\Developer\\nfl-prop-ledger" });
  assert.match(windows, /cd \/d "C:\\Users\\friend\\Developer\\nfl-prop-ledger"/);
  assert.match(windows, /run-automatic\.mjs/);
  const windowsLocal = windowsRunner({ nodePath: "node.exe", repoPath: "C:\\Ledger", localOnly: true, script: "serve-local.mjs" });
  assert.match(windowsLocal, /set NFL_PROP_LOCAL_ONLY=1/);
  assert.match(windowsLocal, /serve-local\.mjs/);

  const service = linuxService({ nodePath: "/usr/bin/node", repoPath: "/home/friend/My Projects/nfl-prop-ledger" });
  assert.match(service, /WorkingDirectory="\/home\/friend\/My Projects\/nfl-prop-ledger"/);
  assert.match(service, /ExecStart="\/usr\/bin\/node" .*run-automatic\.mjs"/);
  assert.match(linuxTimer(), /OnCalendar=\*-\*-\* 08:32:00/);
  const localService = linuxService({ nodePath: "/usr/bin/node", repoPath: "/home/friend/ledger", localOnly: true, script: "serve-local.mjs", keepAlive: true });
  assert.match(localService, /Environment=NFL_PROP_LOCAL_ONLY=1/);
  assert.match(localService, /Restart=on-failure/);
});

test("selects local-only storage when requested, marked, or no Git checkout exists", () => {
  assert.equal(localOnlyRequested({ environmentValue: "1", gitAvailable: true, markerAvailable: false }), true);
  assert.equal(localOnlyRequested({ environmentValue: undefined, gitAvailable: true, markerAvailable: true }), true);
  assert.equal(localOnlyRequested({ environmentValue: undefined, gitAvailable: false, markerAvailable: false }), true);
  assert.equal(localOnlyRequested({ environmentValue: undefined, gitAvailable: true, markerAvailable: false }), false);
});

test("builds stable raw capture paths for every source", () => {
  assert.deepEqual(capturePaths("/home/friend", "2026-08-22", "draftkings"), {
    primary: "/home/friend/Downloads/nfl-prop-ledger/2026-08-22/draftkings-primary-raw.json",
    confirmation: "/home/friend/Downloads/nfl-prop-ledger/2026-08-22/draftkings-confirmation-raw.json",
  });
  assert.deepEqual(capturePaths("/home/friend", "2026-08-22", "draftkings", "/repo/.private/browser-captures"), {
    primary: "/repo/.private/browser-captures/2026-08-22/draftkings-primary-raw.json",
    confirmation: "/repo/.private/browser-captures/2026-08-22/draftkings-confirmation-raw.json",
  });
});

test("waits for all sources or a settled partial capture before processing", () => {
  assert.equal(captureSetIsReady({ freshSources: [], unchangedForMs: 60_000 }), false);
  assert.equal(captureSetIsReady({ freshSources: ["prizepicks"], unchangedForMs: 9 * 60_000 }), false);
  assert.equal(captureSetIsReady({ freshSources: ["prizepicks"], unchangedForMs: 10 * 60_000 }), true);
  assert.equal(captureSetIsReady({ freshSources: ["prizepicks", "draftkings"], unchangedForMs: 0 }), false);
  assert.equal(captureSetIsReady({ freshSources: ["prizepicks", "underdog"], unchangedForMs: 0 }), true);
});

test("finds valid pairs, ignores missing and partially written evidence, and propagates real I/O failures", async () => {
  const files = new Map([
    ["prizepicks-primary-raw.json", { source: "prizepicks" }],
    ["prizepicks-confirmation-raw.json", { source: "prizepicks" }],
  ]);
  const readJson = async (file) => {
    const name = file.split("/").at(-1);
    if (name === "draftkings-primary-raw.json") throw new SyntaxError("partial JSON");
    if (!files.has(name)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files.get(name);
  };
  const validatePair = (primary, confirmation, options) => primary.source === options.source && confirmation.source === options.source ? [] : ["bad"];
  assert.deepEqual(await findFreshCaptureSources({ homeDirectory: "/home/friend", date: "2026-08-22", readJson, validatePair }), ["prizepicks"]);

  const utcFolderRead = async (file) => {
    if (!file.includes("/2026-08-23/")) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    const name = file.split("/").at(-1);
    if (!name.startsWith("prizepicks-")) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { source: "prizepicks" };
  };
  assert.deepEqual(await findFreshCaptureSources({
    homeDirectory: "/home/friend",
    date: "2026-08-22",
    captureDates: ["2026-08-22", "2026-08-23"],
    readJson: utcFolderRead,
    validatePair,
  }), ["prizepicks"]);

  const denied = async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
  await assert.rejects(findFreshCaptureSources({ homeDirectory: "/home/friend", date: "2026-08-22", readJson: denied, validatePair }), /denied/);
});
