import assert from "node:assert/strict";
import test from "node:test";
import { parseUnderdogRows, underdogNormalizedProbability, underdogStatType } from "../collector/adapters/underdog.mjs";

const rosterByName = new Map([
  ["jaxon smith njigba", { id: "jaxon-smith-njigba", name: "Jaxon Smith-Njigba", team: "SEA", position: "WR" }],
  ["dak prescott", { id: "dak-prescott", name: "Dak Prescott", team: "DAL", position: "QB" }],
]);

test("normalizes both Underdog modifiers into a two-sided probability", () => {
  assert.equal(Number(underdogNormalizedProbability(1.13, 0.83).toFixed(4)), 0.4235);
  assert.equal(Number.isNaN(underdogNormalizedProbability(0, 0.83)), true);
});

test("maps supported Underdog Week 1 labels", () => {
  assert.equal(underdogStatType("Pass Yards"), "passing_yards");
  assert.equal(underdogStatType("Rush + Rec TDs"), "offensive_touchdowns");
  assert.equal(underdogStatType("Pass TDs"), "passing_touchdowns");
  assert.equal(underdogStatType("Rush Yards"), "rushing_yards");
  assert.equal(underdogStatType("Receiving Yards"), "receiving_yards");
  assert.equal(underdogStatType("Receptions"), "receptions");
});

test("parses standard Week 1 touchdown pairs and ignores specials", () => {
  const result = parseUnderdogRows([
    { playerName: "Jaxon Smith-Njigba", statLabel: "Rush + Rec TDs", line: 0.5, higherMultiplier: 1.13, lowerMultiplier: 0.83 },
    { playerName: "Dak Prescott", statLabel: "Pass TDs", line: 1.5, higherMultiplier: 0.89, lowerMultiplier: 1.08 },
    { playerName: "Jaxon Smith-Njigba", statLabel: "Rush + Rec TDs", line: 0.25, higherMultiplier: 1, lowerMultiplier: 1, isNonStandard: true },
  ], {
    rosterByName,
    sourceUrl: "https://app.underdogsports.com/pick-em/higher-lower/all/NFL",
    capturedAt: "2026-08-26T14:00:00.000Z",
    season: 2026,
    requiredStatTypes: ["passing_touchdowns", "offensive_touchdowns"],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations.length, 2);
  assert.equal(result.observations[0].marketScope, "week_1");
  assert.equal(result.observations[0].normalizedProbability.toFixed(4), "0.4235");
});

test("accepts standard Underdog projection lines without modifiers", () => {
  const result = parseUnderdogRows([
    { playerName: "Dak Prescott", statLabel: "Pass Yards", line: 267.5 },
    { playerName: "Dak Prescott", statLabel: "Rush Yards", line: 8.5 },
    { playerName: "Jaxon Smith-Njigba", statLabel: "Receiving Yards", line: 84.5 },
    { playerName: "Jaxon Smith-Njigba", statLabel: "Receptions", line: 6.5, higherMultiplier: 0.83, lowerMultiplier: 1.12 },
  ], {
    rosterByName,
    sourceUrl: "https://app.underdogsports.com/pick-em/higher-lower/all/NFL",
    capturedAt: "2026-08-26T14:00:00.000Z",
    season: 2026,
    requiredStatTypes: ["passing_yards", "rushing_yards", "receiving_yards", "receptions"],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations.length, 4);
  assert.equal(result.observations[0].normalizedProbability, undefined);
  assert.ok(result.observations[3].normalizedProbability > 0.5);
});
