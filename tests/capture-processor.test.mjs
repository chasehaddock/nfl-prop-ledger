import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { BETMGM_MARKETS } from "../collector/betmgm-config.mjs";
import { FANDUEL_MARKETS } from "../collector/fanduel-config.mjs";
import { PRIZEPICKS_MARKETS } from "../collector/prizepicks-config.mjs";
import { UNDERDOG_MARKETS } from "../collector/underdog-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capturedAt = "2026-08-19T14:17:00.000Z";

function pair(player, statLabel, line, overOdds = "-110", underOdds = "-110") {
  return [
    { ariaLabel: `${player} Regular Season ${statLabel} 2026-27, ${player} Over ${line}, ${overOdds}` },
    { ariaLabel: `${player} Regular Season ${statLabel} 2026-27, ${player} Under ${line}, ${underOdds}` },
  ];
}

async function processRaw(raw) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prop-ledger-test-"));
  const input = path.join(directory, "raw.json");
  const output = path.join(directory, "capture.json");
  await writeFile(input, JSON.stringify(raw));
  const result = spawnSync(process.execPath, ["scripts/process-browser-capture.mjs", input, output], {
    cwd: root,
    encoding: "utf8",
  });
  const capture = result.status === 0 ? JSON.parse(await readFile(output, "utf8")) : null;
  return { result, capture };
}

test("processes a complete FanDuel browser envelope", async () => {
  const rows = [
    ...pair("Jared Goff", "Passing Yards", "4050.5"),
    ...pair("Baker Mayfield", "Passing TDs", "25.5", "-102", "-130"),
    ...pair("Derrick Henry", "Rushing Yards", "1250.5"),
    ...pair("Jahmyr Gibbs", "Rushing TDs", "12.5", "-105", "-125"),
    ...pair("Amon-Ra St. Brown", "Receiving Yards", "1225.5", "-114", "-114"),
  ];
  const { result, capture } = await processRaw({
    source: "fanduel",
    season: 2026,
    capturedAt,
    pages: [{ ...FANDUEL_MARKETS[0], capturedAt, rows }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(capture.source, "fanduel");
  assert.equal(capture.observations.length, 5);
});

test("processes FanDuel season props and Week 1 Passing TD odds in one normal capture", async () => {
  const eventUrl = "https://sportsbook.fanduel.com/football/nfl/new-england-patriots-@-seattle-seahawks-35607262?tab=passing-props";
  const rows = [
    ...pair("Jared Goff", "Passing Yards", "4050.5"),
    ...pair("Baker Mayfield", "Passing TDs", "25.5", "-102", "-130"),
    ...pair("Derrick Henry", "Rushing Yards", "1250.5"),
    ...pair("Jahmyr Gibbs", "Rushing TDs", "12.5", "-105", "-125"),
    ...pair("Amon-Ra St. Brown", "Receiving Yards", "1225.5", "-114", "-114"),
    { ariaLabel: "Sam Darnold - Passing TDs, Sam Darnold Over, 1.5, +106", marketScope: "week_1", sourceUrl: eventUrl },
    { ariaLabel: "Sam Darnold - Passing TDs, Sam Darnold Under, 1.5, -140", marketScope: "week_1", sourceUrl: eventUrl },
  ];
  const { result, capture } = await processRaw({
    source: "fanduel",
    season: 2026,
    capturedAt,
    pages: [{ ...FANDUEL_MARKETS[0], capturedAt, rows }],
  });
  assert.equal(result.status, 0, result.stderr);
  const weekly = capture.observations.find((item) => item.marketScope === "week_1");
  assert.equal(capture.observations.length, 6);
  assert.equal(weekly.player.name, "Sam Darnold");
  assert.equal(weekly.overOdds, 106);
  assert.equal(weekly.underOdds, -140);
  assert.equal(weekly.sourceUrl, eventUrl);
});

test("processes all six BetMGM stat tabs and retains Puka Nacua", async () => {
  const market = (statLabel, playerName, line, overOdds = "-110", underOdds = "-110") => ({
    statLabel,
    playerName,
    outcomes: [{ title: `O ${line}`, odds: overOdds }, { title: `U ${line}`, odds: underOdds }],
  });
  const rows = [
    market("Passing yards O/U", "Jared Goff", "4050.5", "-115", "-105"),
    market("Passing TDs", "Joe Burrow", "32.5", "-115", "-105"),
    market("Rushing yards O/U", "Derrick Henry", "1250.5", "-115", "-105"),
    market("Rushing TDs", "Jahmyr Gibbs", "12.5", "-105", "-125"),
    market("Receiving yards O/U", "Puka Nacua", "1350.5"),
    market("Receiving TDs", "Puka Nacua", "8.5", "+105", "-125"),
  ];
  const { result, capture } = await processRaw({
    source: "betmgm",
    season: 2026,
    capturedAt,
    pages: [{ ...BETMGM_MARKETS[0], capturedAt, rows }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(capture.source, "betmgm");
  assert.equal(capture.observations.length, 6);
  assert.deepEqual(
    capture.observations.filter((item) => item.player.name === "Puka Nacua").map((item) => [item.statType, item.line]),
    [["receiving_yards", 1350.5], ["receiving_touchdowns", 8.5]],
  );
});

test("fails closed when a configured BetMGM stat tab is absent", async () => {
  const { result } = await processRaw({
    source: "betmgm",
    season: 2026,
    capturedAt,
    pages: [{
      ...BETMGM_MARKETS[0],
      capturedAt,
      rows: [{
        statLabel: "Receiving yards O/U",
        playerName: "Puka Nacua",
        outcomes: [{ title: "O 1350.5", odds: "-110" }, { title: "U 1350.5", odds: "-110" }],
      }],
    }],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required BetMGM stat is missing/);
});

test("processes a complete PrizePicks projection envelope", async () => {
  const rows = [
    { playerName: "Jared Goff", line: "4075.5", statLabel: "Pass Yards" },
    { playerName: "Jared Goff", line: "28.5", statLabel: "Pass TDs" },
    { playerName: "Derrick Henry", line: "1175.5", statLabel: "Rush Yards" },
    { playerName: "Derrick Henry", line: "11.5", statLabel: "Rush TDs" },
    { playerName: "Amon-Ra St. Brown", line: "1125.5", statLabel: "Rec Yards" },
    { playerName: "Amon-Ra St. Brown", line: "8.5", statLabel: "Rec TDs" },
    { playerName: "Amon-Ra St. Brown", line: "94.5", statLabel: "Receptions" },
  ];
  const { result, capture } = await processRaw({
    source: "prizepicks",
    season: 2026,
    capturedAt,
    pages: [{ ...PRIZEPICKS_MARKETS[0], capturedAt, rows }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(capture.source, "prizepicks");
  assert.equal(capture.providerType, "projection");
  assert.equal(capture.observations.length, 7);
  assert.equal(capture.observations[0].overOdds, undefined);
});

test("processes Underdog Week 1 projections and normalized modifiers", async () => {
  const rows = [
    { playerName: "Jaxon Smith-Njigba", statLabel: "Rush + Rec TDs", line: 0.5, higherMultiplier: 1.13, lowerMultiplier: 0.83 },
    { playerName: "Dak Prescott", statLabel: "Pass TDs", line: 1.5, higherMultiplier: 0.89, lowerMultiplier: 1.08 },
    { playerName: "Dak Prescott", statLabel: "Pass Yards", line: 267.5 },
    { playerName: "Dak Prescott", statLabel: "Rush Yards", line: 8.5 },
    { playerName: "Jaxon Smith-Njigba", statLabel: "Receiving Yards", line: 84.5 },
    { playerName: "Jaxon Smith-Njigba", statLabel: "Receptions", line: 6.5, higherMultiplier: 0.83, lowerMultiplier: 1.12 },
  ];
  const { result, capture } = await processRaw({
    source: "underdog",
    season: 2026,
    capturedAt,
    pages: [{ ...UNDERDOG_MARKETS[0], capturedAt, rows }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(capture.source, "underdog");
  assert.equal(capture.providerType, "multiplier");
  assert.equal(capture.observations.length, 6);
  assert.equal(capture.observations[0].normalizedProbability.toFixed(4), "0.4235");
});
