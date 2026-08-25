import assert from "node:assert/strict";
import test from "node:test";

import { PRIOR_SEASON_PLAYER_STATS, priorSeasonPlayerStats, projectEighteenGamePace } from "../src/prior-season-player-stats.ts";

test("provides generated 2025 NFL per-game inputs with real sample sizes", () => {
  assert.equal(Object.keys(PRIOR_SEASON_PLAYER_STATS).length, 610);
  assert.deepEqual(priorSeasonPlayerStats("00-0040743"), {
    playerName: "Tyler Shough",
    position: "QB",
    gamesPlayed: 11,
    passingYards: 2384,
    passingTouchdowns: 10,
    rushingYards: 186,
    rushingTouchdowns: 3,
    receptions: 0,
    receivingYards: 0,
    receivingTouchdowns: 0,
    season: 2025,
    league: "NFL",
    sourceUrl: "https://github.com/nflverse/nflverse-data/releases/tag/stats_player",
  });
  assert.equal(projectEighteenGamePace(186, 11), 304.4);
});

test("has no college-only fallback for a player without 2025 NFL statistics", () => {
  assert.equal(priorSeasonPlayerStats("00-0041562"), null);
});
