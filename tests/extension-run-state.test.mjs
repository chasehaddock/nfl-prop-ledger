import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RUN_LEASE_MS, isRunLeaseActive } from "../extension/run-state.js";

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

test("extension capture is manual-only and clears the retired daily alarm", async () => {
  const service = await readFile(new URL("../extension/service.js", import.meta.url), "utf8");
  const popup = await readFile(new URL("../extension/popup.html", import.meta.url), "utf8");
  assert.match(service, /chrome\.alarms\.clear\("daily-capture"\)/);
  assert.doesNotMatch(service, /chrome\.alarms\.create\("daily-capture"/);
  assert.doesNotMatch(service, /chrome\.alarms\.onAlarm/);
  assert.match(popup, /Manual capture only/);
});

test("extension accelerates collection without overlapping login-sensitive sources", async () => {
  const service = await readFile(new URL("../extension/service.js", import.meta.url), "utf8");
  assert.match(service, /waitForScraperPage\(tabId, scraper\)/);
  assert.doesNotMatch(service, /attempt === 0 \? 3000 : 5000/);
  assert.match(service, /source\.id === "draftkings"/);
  assert.match(service, /source\.id !== "draftkings"/);
  assert.match(service, /await Promise\.all\(/);
  assert.match(service, /for \(const source of interactiveSources\) await captureSource\(source\)/);
  assert.match(service, /verificationMode: "validated-single-pass"/);
  assert.match(service, /Required market categories are missing/);
});

test("FanDuel expands markets in bounded batches and retains exact pair validation", async () => {
  const service = await readFile(new URL("../extension/service.js", import.meta.url), "utf8");
  assert.match(service, /const batchSize = 12/);
  assert.match(service, /pendingLabels\.slice\(offset, offset \+ batchSize\)/);
  assert.match(service, /for \(const card of cards\) card\.click\(\)/);
  assert.match(service, /const readOutcomeIndex = \(\) =>/);
  assert.match(service, /outcomeIndex = readOutcomeIndex\(\)/);
  assert.match(service, /for \(const marketLabel of marketLabels\)/);
  assert.match(service, /if \(outcomes\.length !== 2\)/);
  assert.match(service, /expectedMarketCount: marketLabels\.size/);
});
