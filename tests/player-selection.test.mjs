import assert from "node:assert/strict";
import test from "node:test";

import { selectConsensusStats, selectPlayerStats } from "../src/player-selection.ts";

const observation = (source, statType, line, status = "open") => ({ source, statType, line, status, capturedAt: "2026-08-20T01:00:00Z" });

test("selects the book carrying the most required stats instead of a higher isolated line", () => {
  const selected = selectPlayerStats([
    observation("complete", "receiving_yards", 1200.5),
    observation("complete", "receptions", 90.5),
    observation("complete", "receiving_touchdowns", 8.5),
    observation("isolated", "receiving_yards", 1300.5),
  ], "WR");
  assert.equal(selected.receiving_yards?.source, "complete");
  assert.equal(selected.receiving_yards?.line, 1200.5);
  assert.equal(selected.receptions?.source, "complete");
  assert.equal(selected.receiving_touchdowns?.source, "complete");
});

test("uses the highest line when books have the same amount of overlap", () => {
  const selected = selectPlayerStats([
    observation("lower", "rushing_yards", 900.5),
    observation("higher", "rushing_yards", 1000.5),
    observation("receptions", "receptions", 40.5),
    observation("touchdowns", "rushing_touchdowns", 7.5),
  ], "RB");
  assert.equal(selected.rushing_yards?.source, "higher");
  assert.equal(selected.rushing_yards?.line, 1000.5);
});

test("selects each stat by overlap and then by its higher line", () => {
  const selected = selectPlayerStats([
    observation("yards-and-receptions", "receiving_yards", 1100.5),
    observation("yards-and-receptions", "receptions", 70.5),
    observation("receptions-and-touchdowns", "receptions", 80.5),
    observation("receptions-and-touchdowns", "receiving_touchdowns", 7.5),
  ], "TE");
  assert.equal(selected.receiving_yards?.source, "yards-and-receptions");
  assert.equal(selected.receptions?.source, "receptions-and-touchdowns");
  assert.equal(selected.receiving_touchdowns?.source, "receptions-and-touchdowns");
});

test("prefers current lines and only falls back to stale data when no current line exists", () => {
  const selected = selectPlayerStats([
    observation("stale", "passing_yards", 5000.5, "stale"),
    observation("current", "passing_yards", 4000.5),
    observation("current", "passing_touchdowns", 30.5),
    observation("current", "rushing_touchdowns", 4.5),
  ], "QB");
  assert.equal(selected.passing_yards?.source, "current");
});

test("can select optional rushing markets for quarterbacks and receivers", () => {
  const selected = selectPlayerStats([
    observation("draftkings", "rushing_yards", 525.5),
    observation("draftkings", "rushing_touchdowns", 4.5),
    observation("fanduel", "receiving_yards", 1100.5),
  ], "QB", ["rushing_yards", "rushing_touchdowns"]);
  assert.equal(selected.rushing_yards?.line, 525.5);
  assert.equal(selected.rushing_touchdowns?.line, 4.5);
  assert.equal(selected.receiving_yards, undefined);
});

test("can select optional receiving markets for running backs", () => {
  const selected = selectPlayerStats([
    observation("betmgm", "receiving_yards", 425.5),
    observation("betmgm", "receiving_touchdowns", 2.5),
    observation("draftkings", "rushing_yards", 1000.5),
  ], "RB", ["receiving_yards", "receiving_touchdowns"]);
  assert.equal(selected.receiving_yards?.line, 425.5);
  assert.equal(selected.receiving_touchdowns?.line, 2.5);
  assert.equal(selected.rushing_yards, undefined);
});

test("consensus averages every current source even when a line is most common", () => {
  const selected = selectConsensusStats([
    observation("draftkings", "passing_yards", 4000.5),
    observation("fanduel", "passing_yards", 4000.5),
    observation("betmgm", "passing_yards", 4050.5),
  ], ["passing_yards"]);
  assert.equal(selected.passing_yards?.line, 4017.17);
  assert.equal(selected.passing_yards?.method, "average");
  assert.equal(selected.passing_yards?.supportCount, 2);
  assert.equal(selected.passing_yards?.candidates.length, 3);
});

test("consensus averages all current lines and excludes stale alternatives", () => {
  const selected = selectConsensusStats([
    observation("draftkings", "rushing_yards", 900.5),
    observation("fanduel", "rushing_yards", 950.5),
    observation("betmgm", "rushing_yards", 1000.5),
    observation("old", "rushing_yards", 3000.5, "stale"),
  ], ["rushing_yards"]);
  assert.equal(selected.rushing_yards?.line, 950.5);
  assert.equal(selected.rushing_yards?.method, "average");
  assert.equal(selected.rushing_yards?.candidates.length, 3);
});

test("consensus uses Underdog only when no preferred current source carries the stat", () => {
  const preferred = selectConsensusStats([
    observation("fanduel", "receptions", 6.5),
    observation("underdog", "receptions", 5.5),
  ], ["receptions"]);
  assert.equal(preferred.receptions?.line, 6.5);
  assert.deepEqual(preferred.receptions?.contributors.map((item) => item.source), ["fanduel"]);
  assert.deepEqual(preferred.receptions?.candidates.map((item) => item.source), ["fanduel", "underdog"]);

  const fallback = selectConsensusStats([
    observation("underdog", "receptions", 5.5),
  ], ["receptions"]);
  assert.equal(fallback.receptions?.line, 5.5);
});
