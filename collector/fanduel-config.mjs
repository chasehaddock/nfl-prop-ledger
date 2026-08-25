export const FANDUEL_SOURCE = {
  id: "fanduel",
  name: "FanDuel",
  providerType: "sportsbook",
  baseUrl: "https://sportsbook.fanduel.com",
};

export const FANDUEL_MARKETS = [{
  id: "player-props",
  url: "https://sportsbook.fanduel.com/navigation/nfl?tab=player-props",
}];

export const FANDUEL_REQUIRED_STAT_TYPES = [
  "passing_yards",
  "passing_touchdowns",
  "rushing_yards",
  "rushing_touchdowns",
  "receiving_yards",
];
