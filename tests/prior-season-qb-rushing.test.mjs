import assert from "node:assert/strict";
import test from "node:test";

import { PRIOR_SEASON_QB_RUSHING, priorSeasonQbRushing } from "../src/prior-season-qb-rushing.ts";
import { projectEighteenGamePace } from "../src/prior-season-receptions.ts";

test("provides 2025 NFL rushing samples for quarterbacks", () => {
  assert.equal(Object.keys(PRIOR_SEASON_QB_RUSHING).length, 29);
  assert.deepEqual(priorSeasonQbRushing("00-0040743"), {
    gamesPlayed: 11,
    rushingYards: 186,
    rushingTouchdowns: 3,
    season: 2025,
    league: "NFL",
    sourceUrl: "https://github.com/nflverse/nflverse-data/releases/tag/stats_player",
  });
  assert.equal(projectEighteenGamePace(186, 11), 304.4);
});

test("does not substitute college rushing totals for a quarterback without NFL history", () => {
  assert.equal(priorSeasonQbRushing("00-0041562"), null);
});
