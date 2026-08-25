export const BETMGM_SOURCE = {
  id: "betmgm",
  name: "BetMGM",
  providerType: "sportsbook",
  baseUrl: "https://www.az.betmgm.com",
};

export const BETMGM_MARKETS = [{
  id: "regular-season-stats",
  url: "https://www.az.betmgm.com/en/sports/events/2026-27-nfl-regular-season-stats-19070789",
}];

export const BETMGM_REQUIRED_STAT_TYPES = [
  "passing_yards",
  "passing_touchdowns",
  "rushing_yards",
  "rushing_touchdowns",
  "receiving_yards",
  "receiving_touchdowns",
];
