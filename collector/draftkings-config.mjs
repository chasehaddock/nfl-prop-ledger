export const DRAFTKINGS_SOURCE = {
  id: "draftkings",
  name: "DraftKings",
  providerType: "sportsbook",
  baseUrl: "https://sportsbook.draftkings.com",
};

const base = "https://sportsbook.draftkings.com/leagues/football/nfl?category=futures&subcategory=player-stats-o-u";

export const DRAFTKINGS_MARKETS = [
  { id: "pass-yards", statType: "passing_yards", url: `${base}&nav_1=pass-yards` },
  { id: "pass-tds", statType: "passing_touchdowns", url: `${base}&nav_1=pass-tds` },
  { id: "rec-yards", statType: "receiving_yards", url: `${base}&nav_1=rec-yards` },
  { id: "rec-tds", statType: "receiving_touchdowns", url: `${base}&nav_1=rec-tds` },
  { id: "receptions", statType: "receptions", url: `${base}&nav_1=receptions` },
  { id: "rush-yards", statType: "rushing_yards", url: `${base}&nav_1=rush-yards` },
  { id: "rush-tds", statType: "rushing_touchdowns", url: `${base}&nav_1=rush-tds` },
];
