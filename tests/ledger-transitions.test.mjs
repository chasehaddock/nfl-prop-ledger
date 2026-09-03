import assert from "node:assert/strict";
import test from "node:test";
import { buildDailySnapshot } from "../lib/ledger.mjs";

function observed(overrides = {}) {
  return {
    source: "fanduel",
    sourceUrl: "https://sportsbook.fanduel.com/example",
    season: 2026,
    player: { id: "00-1", name: "Test Player", team: "DEN", position: "WR" },
    marketScope: "regular_season",
    statType: "receiving_yards",
    line: 999.5,
    overOdds: -110,
    underOdds: -110,
    evidenceHash: "1234567890abcdef",
    confirmed: true,
    isMain: true,
    ...overrides,
  };
}

function capture(observations, overrides = {}) {
  return {
    source: "fanduel",
    providerType: "sportsbook",
    season: 2026,
    capturedAt: "2026-08-19T14:19:00.000Z",
    complete: true,
    observations,
    ...overrides,
  };
}

test("records an opening line, then its daily line and price changes", () => {
  const first = buildDailySnapshot({ date: "2026-08-19", season: 2026, captures: [capture([observed()])] });
  assert.equal(first.observations[0].changeType, "opened");
  assert.equal(first.observations[0].lineDelta, null);

  const higher = buildDailySnapshot({
    date: "2026-08-20",
    season: 2026,
    captures: [capture([observed({ line: 1024.5 })])],
    previousSnapshot: first,
  });
  assert.equal(higher.observations[0].changeType, "line_increased");
  assert.equal(higher.observations[0].lineDelta, 25);

  const repriced = buildDailySnapshot({
    date: "2026-08-21",
    season: 2026,
    captures: [capture([observed({ line: 1024.5, overOdds: -120, underOdds: 100 })])],
    previousSnapshot: higher,
  });
  assert.equal(repriced.observations[0].changeType, "odds_changed");
});

test("tracks a Week 1 line independently from the same season-long stat", () => {
  const first = buildDailySnapshot({
    date: "2026-08-23",
    season: 2026,
    captures: [capture([observed(), observed({ marketScope: "week_1", line: 74.5 })])],
  });
  const next = buildDailySnapshot({
    date: "2026-08-24",
    season: 2026,
    captures: [capture([observed(), observed({ marketScope: "week_1", line: 69.5 })])],
    previousSnapshot: first,
  });
  const season = next.observations.find((item) => item.marketScope === "regular_season");
  const weekly = next.observations.find((item) => item.marketScope === "week_1");
  assert.equal(season.changeType, "unchanged");
  assert.equal(weekly.changeType, "line_decreased");
  assert.equal(weekly.lineDelta, -5);
});

test("marks a line not seen once and removed only after two accepted runs", () => {
  const prior = buildDailySnapshot({ date: "2026-08-19", season: 2026, captures: [capture([observed()])] });
  const firstMiss = buildDailySnapshot({
    date: "2026-08-20",
    season: 2026,
    captures: [capture([observed({ player: { id: "00-2", name: "Other Player", team: "DEN", position: "WR" } })])],
    previousSnapshot: prior,
  });
  assert.equal(firstMiss.observations.find((item) => item.player.id === "00-1").status, "not_seen");

  const secondMiss = buildDailySnapshot({
    date: "2026-08-21",
    season: 2026,
    captures: [capture([observed({ player: { id: "00-2", name: "Other Player", team: "DEN", position: "WR" } })])],
    previousSnapshot: firstMiss,
  });
  assert.equal(secondMiss.observations.find((item) => item.player.id === "00-1").status, "removed");
});

test("a rejected or missing source run carries prior values forward as stale", () => {
  const prior = buildDailySnapshot({ date: "2026-08-19", season: 2026, captures: [capture([observed()])] });
  const rejected = buildDailySnapshot({
    date: "2026-08-20",
    season: 2026,
    captures: [capture([observed({ confirmed: false })])],
    previousSnapshot: prior,
  });
  assert.equal(rejected.sourceRuns[0].status, "rejected");
  assert.equal(rejected.observations[0].status, "stale");
  assert.equal(rejected.observations[0].line, 999.5);

  const notRun = buildDailySnapshot({ date: "2026-08-21", season: 2026, captures: [], previousSnapshot: prior });
  assert.equal(notRun.sourceRuns[0].status, "not_run");
  assert.equal(notRun.observations[0].status, "stale");
});
