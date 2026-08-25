import assert from "node:assert/strict";
import test from "node:test";

import { PRIOR_SEASON_RB_RECEIVING, priorSeasonRbReceiving, priorSeasonReceptions, projectEighteenGamePace } from "../src/prior-season-receptions.ts";

test("provides verified 2025 NFL receiving fallbacks for veteran running backs", () => {
  assert.equal(Object.keys(PRIOR_SEASON_RB_RECEIVING).length, 34);
  assert.deepEqual(priorSeasonReceptions("00-0033280"), {
    gamesPlayed: 17,
    receptions: 102,
    receivingYards: 924,
    season: 2025,
    league: "NFL",
    sourceUrl: "https://github.com/nflverse/nflverse-data/releases/tag/stats_player",
  });
  assert.equal(priorSeasonRbReceiving("00-0038542")?.receptions, 79);
  assert.equal(priorSeasonRbReceiving("00-0038542")?.receivingYards, 820);
});

test("projects both receiving stats at an 18-game per-game pace", () => {
  assert.equal(projectEighteenGamePace(4, 4), 18);
  assert.equal(projectEighteenGamePace(333, 16), 374.6);
  assert.equal(projectEighteenGamePace(32, 9), 64);
});

test("does not substitute college totals for rookies without a 2025 NFL season", () => {
  assert.equal(priorSeasonReceptions("00-0041027"), null);
  assert.equal(priorSeasonReceptions("00-0041512"), null);
});
