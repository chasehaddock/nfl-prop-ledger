export type PriorSeasonQbRushing = {
  gamesPlayed: number;
  rushingYards: number;
  rushingTouchdowns: number;
  season: 2025;
  league: "NFL";
  sourceUrl: string;
};

const NFL_SOURCE = "https://github.com/nflverse/nflverse-data/releases/tag/stats_player";
const nfl = (gamesPlayed: number, rushingYards: number, rushingTouchdowns: number): PriorSeasonQbRushing => ({
  gamesPlayed,
  rushingYards,
  rushingTouchdowns,
  season: 2025,
  league: "NFL",
  sourceUrl: NFL_SOURCE,
});

export const PRIOR_SEASON_QB_RUSHING: Record<string, PriorSeasonQbRushing> = {
  "00-0023459": nfl(16, 61, 1),
  "00-0034855": nfl(17, 382, 1),
  "00-0039732": nfl(17, 356, 5),
  "00-0037834": nfl(9, 147, 3),
  "00-0039150": nfl(16, 216, 2),
  "00-0039163": nfl(14, 209, 1),
  "00-0039918": nfl(17, 388, 3),
  "00-0040676": nfl(17, 159, 2),
  "00-0033077": nfl(17, 177, 2),
  "00-0035710": nfl(13, 164, 5),
  "00-0039851": nfl(17, 450, 4),
  "00-0030565": nfl(15, 109, 0),
  "00-0033119": nfl(14, 168, 1),
  "00-0036389": nfl(16, 421, 8),
  "00-0033106": nfl(17, 45, 0),
  "00-0040691": nfl(14, 487, 9),
  "00-0039910": nfl(7, 278, 2),
  "00-0036442": nfl(8, 41, 0),
  "00-0036264": nfl(15, 199, 0),
  "00-0034857": nfl(16, 579, 14),
  "00-0036355": nfl(16, 498, 2),
  "00-0035228": nfl(5, 173, 1),
  "00-0034796": nfl(13, 349, 2),
  "00-0038128": nfl(4, 123, 2),
  "00-0026498": nfl(17, 1, 0),
  "00-0033873": nfl(14, 422, 5),
  "00-0034869": nfl(17, 95, 0),
  "00-0036971": nfl(17, 359, 9),
  "00-0040743": nfl(11, 186, 3),
};

export function priorSeasonQbRushing(playerId: string): PriorSeasonQbRushing | null {
  return PRIOR_SEASON_QB_RUSHING[playerId] || null;
}
