import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RUN_LEASE_MS, filterActiveFailedSourceIds, isRunLeaseActive } from "../extension/run-state.js";

test("recognizes a current timestamped capture lease", () => {
  assert.equal(isRunLeaseActive({ running: true, runningSince: 10_000 }, 10_001), true);
});

test("rejects the legacy boolean lock that caused the frozen popup", () => {
  assert.equal(isRunLeaseActive({ running: true }, 10_000), false);
});

test("rejects expired, future, and completed capture leases", () => {
  assert.equal(isRunLeaseActive({ running: true, runningSince: 10_000 }, 10_000 + RUN_LEASE_MS), false);
  assert.equal(isRunLeaseActive({ running: true, runningSince: 10_001 }, 10_000), false);
  assert.equal(isRunLeaseActive({ running: false, runningSince: 10_000 }, 10_001), false);
});

test("drops retired sportsbook ids from the same-day retry list", () => {
  assert.deepEqual(
    filterActiveFailedSourceIds(["fanduel", "prizepicks", "draftkings", "prizepicks"], ["prizepicks", "underdog"]),
    ["prizepicks"],
  );
  assert.deepEqual(filterActiveFailedSourceIds(["fanduel"], ["prizepicks", "underdog"]), []);
});

test("extension capture is manual-only and clears the retired daily alarm", async () => {
  const service = await readFile(new URL("../extension/service.js", import.meta.url), "utf8");
  const popup = await readFile(new URL("../extension/popup.html", import.meta.url), "utf8");
  assert.match(service, /chrome\.alarms\.clear\("daily-capture"\)/);
  assert.doesNotMatch(service, /chrome\.alarms\.create\("daily-capture"/);
  assert.doesNotMatch(service, /chrome\.alarms\.onAlarm/);
  assert.match(popup, /Manual capture only/);
});

test("extension captures PrizePicks and Underdog sequentially with strict validation", async () => {
  const service = await readFile(new URL("../extension/service.js", import.meta.url), "utf8");
  assert.match(service, /waitForScraperPage\(tabId, scraper\)/);
  assert.doesNotMatch(service, /attempt === 0 \? 3000 : 5000/);
  assert.doesNotMatch(service, /id: "draftkings"/);
  assert.doesNotMatch(service, /id: "fanduel"/);
  assert.match(service, /for \(const source of runSources\) await captureSource\(source\)/);
  assert.match(service, /verificationMode: "validated-single-pass"/);
  assert.match(service, /Required market categories are missing/);
  assert.match(service, /scanCurrentBoard/);
  assert.doesNotMatch(service, /popularButton/);
  assert.match(service, /\["fantasy", "Fantasy Score"\]/);
  assert.match(service, /fantasy points/);
  assert.match(service, /for \(let scanPass = 0; scanPass < 2; scanPass \+= 1\)/);
  assert.doesNotMatch(service, /findSearchInput|expectedUnderdogPassingPlayers/);
});
