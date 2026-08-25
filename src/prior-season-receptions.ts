export type PriorSeasonRbReceiving = {
  gamesPlayed: number;
  receptions: number;
  receivingYards: number;
  season: 2025;
  league: "NFL";
  sourceUrl: string;
};

const NFL_SOURCE = "https://github.com/nflverse/nflverse-data/releases/tag/stats_player";
const nfl = (gamesPlayed: number, receptions: number, receivingYards: number): PriorSeasonRbReceiving => ({
  gamesPlayed,
  receptions,
  receivingYards,
  season: 2025,
  league: "NFL",
  sourceUrl: NFL_SOURCE,
});

export const PRIOR_SEASON_RB_RECEIVING: Record<string, PriorSeasonRbReceiving> = {
  "00-0033293": nfl(12, 28, 199),
  "00-0040122": nfl(17, 55, 346),
  "00-0040719": nfl(15, 10, 79),
  "00-0038542": nfl(17, 79, 820),
  "00-0039738": nfl(17, 8, 36),
  "00-0038120": nfl(16, 36, 350),
  "00-0039361": nfl(10, 30, 277),
  "00-0040715": nfl(8, 24, 207),
  "00-0038597": nfl(17, 69, 437),
  "00-0033280": nfl(17, 102, 924),
  "00-0036555": nfl(15, 30, 223),
  "00-0036275": nfl(16, 34, 299),
  "00-0035685": nfl(17, 24, 192),
  "00-0039040": nfl(16, 67, 488),
  "00-0032764": nfl(17, 15, 150),
  "00-0037197": nfl(13, 19, 101),
  "00-0036158": nfl(10, 11, 37),
  "00-0040242": nfl(17, 9, 68),
  "00-0039139": nfl(17, 77, 616),
  "00-0037248": nfl(17, 33, 291),
  "00-0036997": nfl(16, 35, 137),
  "00-0037228": nfl(16, 40, 333),
  "00-0036223": nfl(17, 46, 378),
  "00-0037525": nfl(16, 14, 51),
  "00-0038134": nfl(17, 31, 282),
  "00-0037840": nfl(17, 36, 281),
  "00-0040666": nfl(9, 32, 192),
  "00-0040784": nfl(14, 26, 171),
  "00-0036875": nfl(14, 32, 345),
  "00-0036139": nfl(17, 39, 297),
  "00-0034844": nfl(16, 37, 273),
  "00-0035261": nfl(17, 33, 206),
  "00-0036973": nfl(17, 36, 292),
  "00-0040734": nfl(17, 35, 221),
};

// Compatibility export for the original receptions-only fallback.
export const PRIOR_SEASON_RB_RECEPTIONS = PRIOR_SEASON_RB_RECEIVING;

export function priorSeasonRbReceiving(playerId: string): PriorSeasonRbReceiving | null {
  return PRIOR_SEASON_RB_RECEIVING[playerId] || null;
}

export function priorSeasonReceptions(playerId: string): PriorSeasonRbReceiving | null {
  return priorSeasonRbReceiving(playerId);
}

export function projectEighteenGamePace(total: number, gamesPlayed: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(gamesPlayed) || gamesPlayed <= 0) return 0;
  return Number(((total / gamesPlayed) * 18).toFixed(1));
}
