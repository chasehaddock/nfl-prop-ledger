import assert from "node:assert/strict";
import test from "node:test";

import { calendarDateInTimeZone, previousSnapshotFilename, retryTransient, validateDailyRawPair } from "../lib/daily-run.mjs";

function raw(source, capturedAt) {
  return { source, season: 2026, capturedAt, pages: [{ id: "props", rows: [{}] }] };
}

test("accepts a same-day pair from the scheduled capture window", () => {
  const errors = validateDailyRawPair(
    raw("prizepicks", "2026-08-20T14:17:36.928Z"),
    raw("prizepicks", "2026-08-20T14:18:18.111Z"),
    { source: "prizepicks", date: "2026-08-20", now: new Date("2026-08-20T19:00:00Z") },
  );
  assert.deepEqual(errors, []);
});

test("accepts an 8:17 AM Central extension capture", () => {
  const errors = validateDailyRawPair(
    raw("prizepicks", "2026-08-24T13:17:34.413Z"),
    raw("prizepicks", "2026-08-24T13:18:09.509Z"),
    { source: "prizepicks", date: "2026-08-24", now: new Date("2026-08-24T14:00:00Z") },
  );
  assert.deepEqual(errors, []);
});

test("accepts a same-day manual capture before the retired morning schedule", () => {
  const errors = validateDailyRawPair(
    raw("prizepicks", "2026-08-27T12:05:56.102Z"),
    raw("prizepicks", "2026-08-27T12:05:56.102Z"),
    { source: "prizepicks", date: "2026-08-27", now: new Date("2026-08-27T12:10:00Z") },
  );
  assert.deepEqual(errors, []);
});

test("rejects a leftover file whose UTC date matches but local date is yesterday", () => {
  const errors = validateDailyRawPair(
    raw("fanduel", "2026-08-20T01:05:40.726Z"),
    raw("fanduel", "2026-08-20T01:05:59.804Z"),
    { source: "fanduel", date: "2026-08-20", now: new Date("2026-08-20T19:00:00Z") },
  );
  assert.ok(errors.some((error) => error.includes("local date")));
});

test("maps an after-midnight UTC timestamp to the prior ledger calendar date", () => {
  assert.equal(calendarDateInTimeZone("2026-08-24T02:38:00.000Z"), "2026-08-23");
});

test("rejects mismatched sources, early captures, and separated confirmation passes", () => {
  const errors = validateDailyRawPair(
    raw("prizepicks", "2026-08-20T12:00:00.000Z"),
    raw("fanduel", "2026-08-20T14:00:01.000Z"),
    { source: "prizepicks", date: "2026-08-20", now: new Date("2026-08-20T19:00:00Z"), earliestMinute: 7 * 60 + 30 },
  );
  assert.ok(errors.some((error) => error.includes("source")));
  assert.ok(errors.some((error) => error.includes("configured run window")));
  assert.ok(errors.some((error) => error.includes("allowed capture window")));
});

test("retries transient filesystem failures but not permanent failures", async () => {
  let attempts = 0;
  const result = await retryTransient(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error("Unknown system error -11"), { errno: -11 });
    return "ok";
  }, { attempts: 4, delayMs: 0 });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);

  await assert.rejects(() => retryTransient(async () => { throw new Error("invalid capture"); }, { attempts: 4, delayMs: 0 }), /invalid capture/);
});

test("same-day reruns keep the prior calendar day as the movement baseline", () => {
  assert.equal(previousSnapshotFilename([
    "2026-08-21.json",
    "2026-08-22.json",
    "2026-08-23.json",
  ], "2026-08-23"), "2026-08-22.json");
  assert.equal(previousSnapshotFilename(["2026-08-23.json"], "2026-08-23"), null);
});
