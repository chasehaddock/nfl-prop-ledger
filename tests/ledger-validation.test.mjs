import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmCapturePair,
  fairOverProbability,
  selectMainLines,
  validateObservation,
} from "../lib/ledger.mjs";

function observation(overrides = {}) {
  return {
    source: "draftkings",
    sourceUrl: "https://sportsbook.draftkings.com/example",
    season: 2026,
    player: { id: "00-1", name: "Test Player", team: "DEN", position: "WR" },
    marketScope: "regular_season",
    statType: "receiving_yards",
    line: 999.5,
    overOdds: -110,
    underOdds: -110,
    evidenceHash: "1234567890abcdef",
    ...overrides,
  };
}

function capture(observations, overrides = {}) {
  return {
    source: "draftkings",
    providerType: "sportsbook",
    season: 2026,
    capturedAt: "2026-08-19T14:17:00.000Z",
    complete: true,
    evidenceHash: "abcdef1234567890",
    observations,
    ...overrides,
  };
}

test("validates a normal sportsbook observation", () => {
  assert.deepEqual(validateObservation(observation()), []);
  assert.equal(fairOverProbability(-110, -110), 0.5);
});

test("validates a projection observation without sportsbook prices", () => {
  assert.deepEqual(validateObservation(observation({
    source: "prizepicks",
    sourceUrl: "https://app.prizepicks.com/",
    overOdds: undefined,
    underOdds: undefined,
  }), "projection"), []);
});

test("validates Week 1 lines against weekly safety ranges", () => {
  assert.deepEqual(validateObservation(observation({ marketScope: "week_1", line: 74.5 })), []);
  assert.ok(validateObservation(observation({ marketScope: "week_1", line: 999.5 })).some((error) => error.includes("safety range")));
});

test("accepts a one-sided Week 1 anytime-touchdown price but not a one-sided yardage market", () => {
  assert.deepEqual(validateObservation(observation({
    marketScope: "week_1",
    statType: "offensive_touchdowns",
    line: 0.5,
    overOdds: 175,
    underOdds: undefined,
  })), []);
  assert.ok(validateObservation(observation({
    marketScope: "week_1",
    statType: "rushing_yards",
    line: 49.5,
    underOdds: undefined,
  })).some((error) => error.includes("underOdds")));
});

test("rejects unsafe lines, invalid prices, and unsupported positions", () => {
  const errors = validateObservation(observation({
    line: 9999.5,
    overOdds: -10,
    player: { name: "Test Player", position: "K" },
  }));
  assert.ok(errors.some((error) => error.includes("safety range")));
  assert.ok(errors.some((error) => error.includes("overOdds")));
  assert.ok(errors.some((error) => error.includes("position")));
});

test("uses a unique book-marked line and never chooses an alternate", () => {
  const result = selectMainLines([
    observation({ line: 899.5, isMain: false }),
    observation({ line: 999.5, isMain: true }),
    observation({ line: 1099.5, isMain: false }),
  ]);
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].line, 999.5);
  assert.equal(result.selected[0].selectionMethod, "book_marker");
});

test("uses the closest fair price only when no main marker exists", () => {
  const result = selectMainLines([
    observation({ line: 899.5, overOdds: -150, underOdds: 120 }),
    observation({ line: 999.5, overOdds: -105, underOdds: -115 }),
  ]);
  assert.equal(result.selected[0].line, 999.5);
  assert.equal(result.selected[0].selectionMethod, "price_balance");
});

test("rejects equally balanced candidate lines instead of guessing", () => {
  const result = selectMainLines([
    observation({ line: 899.5 }),
    observation({ line: 999.5 }),
  ]);
  assert.equal(result.selected.length, 0);
  assert.match(result.errors[0], /equally balanced/);
});

test("requires the primary and confirmation passes to match exactly", () => {
  const matched = confirmCapturePair(capture([observation()]), capture([observation()], {
    capturedAt: "2026-08-19T14:19:00.000Z",
  }));
  assert.equal(matched.capture.observations[0].confirmed, true);

  const changed = confirmCapturePair(capture([observation()]), capture([observation({ line: 1000.5 })]));
  assert.equal(changed.capture.observations[0].confirmed, false);
});
