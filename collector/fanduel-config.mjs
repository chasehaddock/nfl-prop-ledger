export const FANDUEL_SOURCE = {
  id: "fanduel",
  name: "FanDuel",
  providerType: "sportsbook",
  baseUrl: "https://sportsbook.fanduel.com",
};

export const FANDUEL_MARKETS = [{
  id: "week-1-player-props",
  url: "https://sportsbook.fanduel.com/navigation/nfl",
}];

export const FANDUEL_REQUIRED_STAT_TYPES = [
  "passing_yards",
  "rushing_yards",
  "receiving_yards",
];
