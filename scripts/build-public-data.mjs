import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const snapshotsDir = path.resolve("data/snapshots");
const publicDir = path.resolve("public/data");
await mkdir(snapshotsDir, { recursive: true });
await mkdir(publicDir, { recursive: true });

const files = (await readdir(snapshotsDir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
const snapshots = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(snapshotsDir, file), "utf8"))));

if (snapshots.length === 0) {
  await Promise.all([
    writeFile(path.join(publicDir, "current.json"), `${JSON.stringify({ demo: true, observations: [], sourceRuns: [] }, null, 2)}\n`),
    writeFile(path.join(publicDir, "history.json"), "{}\n"),
    writeFile(path.join(publicDir, "week-1.json"), `${JSON.stringify({ demo: false, week: 1, observations: [], movements: [], sourceRuns: [] }, null, 2)}\n`),
    writeFile(path.join(publicDir, "week-1-history.json"), "{}\n"),
  ]);
  console.log("No verified snapshots exist; published an empty demo dataset.");
  process.exit(0);
}

function buildScope(scope, extra = {}) {
  const scopedSnapshots = snapshots.map((snapshot) => ({
    ...snapshot,
    observations: snapshot.observations.filter((observation) => (observation.marketScope || "regular_season") === scope),
  }));
  const movements = scopedSnapshots.flatMap((snapshot) => snapshot.observations
    .filter((observation) => ["line_increased", "line_decreased"].includes(observation.changeType))
    .map((observation) => ({
      date: snapshot.date,
      key: observation.key,
      source: observation.source,
      sourceName: observation.sourceName,
      sourceUrl: observation.sourceUrl,
      player: observation.player,
      marketScope: observation.marketScope || "regular_season",
      statType: observation.statType,
      line: observation.line,
      lineDelta: observation.lineDelta,
      changeType: observation.changeType,
    })));
  const latest = scopedSnapshots.findLast((snapshot) => snapshot.observations.length > 0);
  const current = latest
    ? { ...latest, ...extra, movements, demo: false }
    : { demo: false, season: snapshots.at(-1)?.season, ...extra, observations: [], movements: [], sourceRuns: [], issues: [] };
  const history = {};
  for (const snapshot of scopedSnapshots) {
    for (const observation of snapshot.observations) {
      history[observation.key] ||= [];
      history[observation.key].push({
        date: snapshot.date,
        line: observation.line,
        overOdds: observation.overOdds ?? null,
        underOdds: observation.underOdds ?? null,
        higherMultiplier: observation.higherMultiplier ?? null,
        lowerMultiplier: observation.lowerMultiplier ?? null,
        status: observation.status,
        changeType: observation.changeType,
      });
    }
  }
  return { current, history };
}

const season = buildScope("regular_season");
const weekOne = buildScope("week_1", { week: 1 });
await Promise.all([
  writeFile(path.join(publicDir, "current.json"), `${JSON.stringify(season.current, null, 2)}\n`),
  writeFile(path.join(publicDir, "history.json"), `${JSON.stringify(season.history, null, 2)}\n`),
  writeFile(path.join(publicDir, "week-1.json"), `${JSON.stringify(weekOne.current, null, 2)}\n`),
  writeFile(path.join(publicDir, "week-1-history.json"), `${JSON.stringify(weekOne.history, null, 2)}\n`),
]);
console.log(`Published ${season.current.observations.length} season observations and ${weekOne.current.observations.length} Week 1 observations.`);
