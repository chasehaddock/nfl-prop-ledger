import assert from "node:assert/strict";
import test from "node:test";
import { parsePrizePicksRows, prizePicksStatType } from "../collector/adapters/prizepicks.mjs";

const sourceUrl = "https://app.prizepicks.com/";
const capturedAt = "2026-08-23T14:17:00.000Z";
const rosterByName = new Map([
  ["jared goff", { id: "jared-goff", name: "Jared Goff", team: "DET", position: "QB" }],
  ["derrick henry", { id: "derrick-henry", name: "Derrick Henry", team: "BAL", position: "RB" }],
  ["amon ra st brown", { id: "amon-ra-st-brown", name: "Amon-Ra St. Brown", team: "DET", position: "WR" }],
]);

test("normalizes PrizePicks season statistic labels", () => {
  assert.equal(prizePicksStatType("Pass Yards"), "passing_yards");
  assert.equal(prizePicksStatType("Receiving TDs"), "receiving_touchdowns");
  assert.equal(prizePicksStatType("Receptions"), "receptions");
  assert.equal(prizePicksStatType("Fantasy Score"), "fantasy_score");
  assert.equal(prizePicksStatType("Rush+Rec TDs", "RB"), "offensive_touchdowns");
  assert.equal(prizePicksStatType("Rush+Rec TDs", "WR"), "offensive_touchdowns");
  assert.equal(prizePicksStatType("Rush+Rec TDs", "QB"), "offensive_touchdowns");
});

test("keeps Week 1 projections separate and maps combined offensive touchdowns by position", () => {
  const result = parsePrizePicksRows([
    { playerName: "Jared Goff", teamPosition: "DET - QB", line: "4075.5", statLabel: "Pass Yards", marketScope: "regular_season" },
    { playerName: "Jared Goff", teamPosition: "DET - QB", line: "248.5", statLabel: "Pass Yards", marketScope: "week_1" },
    { playerName: "Jared Goff", teamPosition: "DET - QB", line: "18.5", statLabel: "Fantasy Score", marketScope: "week_1" },
    { playerName: "Derrick Henry", teamPosition: "BAL - RB", line: "72.5", statLabel: "Rush Yards", marketScope: "week_1" },
    { playerName: "Derrick Henry", teamPosition: "BAL - RB", line: "0.5", statLabel: "Rush+Rec TDs", marketScope: "week_1" },
    { playerName: "Amon-Ra St. Brown", teamPosition: "DET - WR", line: "68.5", statLabel: "Rec Yards", marketScope: "week_1" },
    { playerName: "Amon-Ra St. Brown", teamPosition: "DET - WR", line: "0.5", statLabel: "Rush+Rec TDs", marketScope: "week_1" },
  ], { rosterByName, sourceUrl, capturedAt, season: 2026, requiredStatTypes: ["passing_yards"] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations.filter((item) => item.marketScope === "week_1").length, 6);
  assert.equal(result.observations.find((item) => item.statType === "fantasy_score")?.line, 18.5);
  assert.equal(result.observations.find((item) => item.player.position === "RB" && item.statType === "offensive_touchdowns")?.line, 0.5);
  assert.equal(result.observations.find((item) => item.player.position === "WR" && item.statType === "offensive_touchdowns")?.line, 0.5);
  assert.notEqual(result.observations[0].marketScope, result.observations[1].marketScope);
});

test("parses pick'em projections without inventing sportsbook odds", () => {
  const result = parsePrizePicksRows([
    { playerName: "Jared Goff", line: "4075.5", statLabel: "Pass Yards" },
    { playerName: "Jared Goff", line: "28.5", statLabel: "Pass TDs" },
    { playerName: "Derrick Henry", line: "1175.5", statLabel: "Rush Yards" },
    { playerName: "Derrick Henry", line: "11.5", statLabel: "Rush TDs" },
    { playerName: "Amon-Ra St. Brown", line: "1125.5", statLabel: "Rec Yards" },
    { playerName: "Amon-Ra St. Brown", line: "8.5", statLabel: "Rec TDs" },
    { playerName: "Amon-Ra St. Brown", line: "94.5", statLabel: "Receptions" },
  ], {
    rosterByName,
    sourceUrl,
    capturedAt,
    season: 2026,
    requiredStatTypes: ["passing_yards", "passing_touchdowns", "rushing_yards", "rushing_touchdowns", "receiving_yards", "receiving_touchdowns", "receptions"],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations.length, 7);
  assert.equal(result.observations[0].source, "prizepicks");
  assert.equal(result.observations[0].line, 4075.5);
  assert.equal(result.observations[0].overOdds, undefined);
});

test("fails closed when a required PrizePicks category is absent", () => {
  const result = parsePrizePicksRows([
    { playerName: "Jared Goff", line: "4075.5", statLabel: "Pass Yards" },
  ], { rosterByName, sourceUrl, capturedAt, season: 2026, requiredStatTypes: ["passing_yards", "receptions"] });
  assert.match(result.errors.join("\n"), /Required PrizePicks stat is missing: receptions/);
});

test("ignores Demon, Goblin, and unsupported-position novelty projections", () => {
  const result = parsePrizePicksRows([
    { playerName: "Jared Goff", teamPosition: "DET - QB", line: "4075.5", statLabel: "Pass Yards" },
    { playerName: "Jared Goff", teamPosition: "DET - QB", line: "4200.5", statLabel: "Pass Yards", isNonStandard: true },
    { playerName: "Jack Fox", teamPosition: "DET - P", line: "0.5", statLabel: "Pass Yards" },
  ], { rosterByName, sourceUrl, capturedAt, season: 2026, requiredStatTypes: ["passing_yards"] });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].line, 4075.5);
});
