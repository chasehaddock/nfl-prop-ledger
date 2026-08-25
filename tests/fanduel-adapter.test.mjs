import assert from "node:assert/strict";
import test from "node:test";
import { parseFanDuelOutcomeLabel, parseFanDuelRows } from "../collector/adapters/fanduel.mjs";
import { normalizeName } from "../lib/ledger.mjs";

const player = { id: "00-0035676", name: "Amon-Ra St. Brown", team: "DET", position: "WR" };
const rosterByName = new Map([[normalizeName(player.name), player]]);
const sourceUrl = "https://sportsbook.fanduel.com/navigation/nfl?tab=player-props";
const labels = [
  "Amon-Ra St. Brown Regular Season Receiving Yards 2026-27, Amon-Ra St. Brown Over 1225.5, -114",
  "Amon-Ra St. Brown Regular Season Receiving Yards 2026-27, Amon-Ra St. Brown Under 1225.5, -114",
];

test("parses FanDuel's live accessible label and verified main line", () => {
  assert.deepEqual(parseFanDuelOutcomeLabel(labels[0]), {
    playerName: "Amon-Ra St. Brown",
    statType: "receiving_yards",
    season: 2026,
    marketScope: "regular_season",
    side: "over",
    line: 1225.5,
    odds: -114,
  });
  const result = parseFanDuelRows(labels.map((ariaLabel) => ({ ariaLabel })), {
    rosterByName,
    sourceUrl,
    capturedAt: "2026-08-19T14:17:00.000Z",
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations[0].line, 1225.5);
  assert.equal(result.observations[0].isMain, true);
  assert.equal(result.observations[0].player.id, player.id);
});

test("parses FanDuel Week 1 Passing TD prices as a verified two-sided market", () => {
  const quarterback = { id: "00-0034869", name: "Sam Darnold", team: "SEA", position: "QB" };
  const weeklyLabels = [
    "Sam Darnold - Passing TDs, Sam Darnold Over, 1.5, +106",
    "Sam Darnold - Passing TDs, Sam Darnold Under, 1.5, -140",
  ];
  assert.deepEqual(parseFanDuelOutcomeLabel(weeklyLabels[0], { season: 2026 }), {
    playerName: "Sam Darnold",
    statType: "passing_touchdowns",
    season: 2026,
    marketScope: "week_1",
    side: "over",
    line: 1.5,
    odds: 106,
  });
  const result = parseFanDuelRows(weeklyLabels.map((ariaLabel) => ({
    ariaLabel,
    marketScope: "week_1",
    sourceUrl: "https://sportsbook.fanduel.com/football/nfl/new-england-patriots-@-seattle-seahawks-35607262?tab=passing-props",
  })), {
    rosterByName: new Map([[normalizeName(quarterback.name), quarterback]]),
    sourceUrl,
    capturedAt: "2026-08-24T19:31:00.000Z",
    season: 2026,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].marketScope, "week_1");
  assert.equal(result.observations[0].line, 1.5);
  assert.equal(result.observations[0].overOdds, 106);
  assert.equal(result.observations[0].underOdds, -140);
  assert.match(result.observations[0].sourceUrl, /tab=passing-props/);
});

test("rejects mismatched player labels and incomplete over/under pairs", () => {
  assert.throws(
    () => parseFanDuelOutcomeLabel(labels[0].replace(", Amon-Ra St. Brown Over", ", Puka Nacua Over")),
    /player labels do not match/,
  );
  const result = parseFanDuelRows([{ ariaLabel: labels[0] }], {
    rosterByName,
    sourceUrl,
    capturedAt: "2026-08-19T14:17:00.000Z",
  });
  assert.match(result.errors[0], /exactly two outcomes/);
});

test("rejects alternate or duplicate lines for the same FanDuel market", () => {
  const rows = [...labels, ...labels.map((label) => label.replace("1225.5", "1200.5"))]
    .map((ariaLabel) => ({ ariaLabel }));
  const result = parseFanDuelRows(rows, {
    rosterByName,
    sourceUrl,
    capturedAt: "2026-08-19T14:17:00.000Z",
  });
  assert.equal(result.observations.length, 0);
  assert.match(result.errors[0], /exactly two outcomes/);
});

test("rejects an unknown player and a missing required stat", () => {
  const result = parseFanDuelRows(labels.map((ariaLabel) => ({ ariaLabel })), {
    rosterByName: new Map(),
    sourceUrl,
    capturedAt: "2026-08-19T14:17:00.000Z",
    requiredStatTypes: ["receiving_yards", "passing_yards"],
  });
  assert.match(result.errors.join(" "), /not in the verified NFL roster index/);
  assert.match(result.errors.join(" "), /Required FanDuel stat is missing/);
});
