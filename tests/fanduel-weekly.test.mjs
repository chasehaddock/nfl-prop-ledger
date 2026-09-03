import assert from "node:assert/strict";
import test from "node:test";

import {
  FANDUEL_WEEKLY_MARKET_TABS,
  buildFanDuelWeeklyMarketPages,
  normalizeFanDuelEventUrls,
} from "../extension/fanduel-weekly.js";

test("normalizes unique FanDuel NFL event links and ignores non-events", () => {
  const event = "https://sportsbook.fanduel.com/football/nfl/new-england-patriots-@-seattle-seahawks-35607262";
  assert.deepEqual(normalizeFanDuelEventUrls([
    `${event}?tab=passing-props`,
    `${event}/`,
    "/football/nfl/san-francisco-49ers-@-los-angeles-rams-35596960?tab=popular",
    "https://sportsbook.fanduel.com/navigation/nfl",
    "https://example.com/football/nfl/not-fanduel-123",
  ]), [
    event,
    "https://sportsbook.fanduel.com/football/nfl/san-francisco-49ers-@-los-angeles-rams-35596960",
  ]);
});

test("builds all three Week 1 yard-market pages per FanDuel event", () => {
  const event = "https://sportsbook.fanduel.com/football/nfl/new-england-patriots-@-seattle-seahawks-35607262";
  const pages = buildFanDuelWeeklyMarketPages([event]);
  assert.deepEqual(pages.map((page) => page.url), FANDUEL_WEEKLY_MARKET_TABS.map((tab) => `${event}?tab=${tab}`));
  assert.ok(pages.every((page) => page.active === false && page.optional === true));
});

test("does not treat FanDuel navigation or non-event links as Week 1 games", () => {
  assert.deepEqual(normalizeFanDuelEventUrls([
    "https://sportsbook.fanduel.com/navigation/nfl?tab=week-1",
    "https://sportsbook.fanduel.com/football/nfl",
    "https://sportsbook.fanduel.com/football/nfl/player-props",
  ]), []);
});
