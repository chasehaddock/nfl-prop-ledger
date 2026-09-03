import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDailySnapshot, confirmCapturePair } from "../lib/ledger.mjs";
import { calendarDateInTimeZone, previousSnapshotFilename } from "../lib/daily-run.mjs";
import { ACTIVE_CAPTURE_SOURCES, observationAllowedBySourcePolicy } from "../lib/source-policy.mjs";

const files = process.argv.slice(2);
if (files.length < 2 || files.length % 2 !== 0) {
  console.error("Pass a primary and confirmation JSON file for each source.");
  process.exit(1);
}

const pairs = [];
for (let index = 0; index < files.length; index += 2) {
  const primary = JSON.parse(await readFile(files[index], "utf8"));
  const confirmation = JSON.parse(await readFile(files[index + 1], "utf8"));
  const result = confirmCapturePair(primary, confirmation);
  if (!result.capture || result.errors.length) {
    console.error(`${primary.source || files[index]} could not be confirmed:\n${result.errors.join("\n")}`);
    process.exit(1);
  }
  result.capture.observations = result.capture.observations.filter(observationAllowedBySourcePolicy);
  if (result.capture.observations.length === 0) {
    console.error(`${primary.source || files[index]} contained no observations allowed by the active source policy.`);
    process.exit(1);
  }
  pairs.push(result.capture);
}

const date = calendarDateInTimeZone(pairs[0].capturedAt);
const season = pairs[0].season;
if (!date || pairs.some((capture) => capture.season !== season || calendarDateInTimeZone(capture.capturedAt) !== date)) {
  console.error("All captures must be from the same date and season.");
  process.exit(1);
}

const snapshotsDir = path.resolve("data/snapshots");
await mkdir(snapshotsDir, { recursive: true });
const existing = (await readdir(snapshotsDir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
// A same-day rerun replaces today's snapshot, but its movement baseline must
// remain yesterday's snapshot. Comparing against an earlier same-day run
// would erase real changes that occurred since yesterday.
const previousFile = previousSnapshotFilename(existing, date);
const previousSnapshot = previousFile
  ? JSON.parse(await readFile(path.join(snapshotsDir, previousFile), "utf8"))
  : null;
if (previousSnapshot) {
  previousSnapshot.observations = previousSnapshot.observations.filter(observationAllowedBySourcePolicy);
  previousSnapshot.sourceRuns = previousSnapshot.sourceRuns.filter((run) => ACTIVE_CAPTURE_SOURCES.includes(run.source));
}

const snapshot = buildDailySnapshot({ date, season, captures: pairs, previousSnapshot });
await writeFile(path.join(snapshotsDir, `${date}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Accepted ${snapshot.observations.length} observations for ${date}.`);
