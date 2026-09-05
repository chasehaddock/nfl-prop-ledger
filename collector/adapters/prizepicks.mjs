import { createHash } from "node:crypto";
import { normalizeName } from "../../lib/ledger.mjs";
import { PRIZEPICKS_SOURCE } from "../prizepicks-config.mjs";

const STAT_LABELS = new Map([
  ["passing yards", "passing_yards"],
  ["pass yards", "passing_yards"],
  ["passing touchdowns", "passing_touchdowns"],
  ["passing tds", "passing_touchdowns"],
  ["pass tds", "passing_touchdowns"],
  ["rushing yards", "rushing_yards"],
  ["rush yards", "rushing_yards"],
  ["rushing touchdowns", "rushing_touchdowns"],
  ["rushing tds", "rushing_touchdowns"],
  ["rush tds", "rushing_touchdowns"],
  ["receiving yards", "receiving_yards"],
  ["rec yards", "receiving_yards"],
  ["receiving touchdowns", "receiving_touchdowns"],
  ["receiving tds", "receiving_touchdowns"],
  ["rec tds", "receiving_touchdowns"],
  ["receptions", "receptions"],
  ["recs", "receptions"],
  ["rec", "receptions"],
  ["fantasy", "fantasy_score"],
  ["fantasy score", "fantasy_score"],
  ["fantasy points", "fantasy_score"],
  ["fantasy pts", "fantasy_score"],
]);

const COMBINED_TOUCHDOWN_LABELS = new Set([
  "rush+rec tds",
  "rush + rec tds",
  "rushing + receiving touchdowns",
  "player touchdowns",
]);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function prizePicksStatType(value, position) {
  const label = String(value).trim().toLowerCase();
  if (COMBINED_TOUCHDOWN_LABELS.has(label)) {
    return ["QB", "RB", "WR", "TE"].includes(position) ? "offensive_touchdowns" : null;
  }
  return STAT_LABELS.get(label) || null;
}

export function parsePrizePicksRows(rows, { rosterByName, sourceUrl, capturedAt, season, requiredStatTypes = [] }) {
  const observations = [];
  const errors = [];
  const seen = new Set();

  rows.forEach((row, index) => {
    try {
      if (row.isNonStandard === true) return;
      const listedPosition = String(row.teamPosition || "").match(/(?:^| - )(QB|RB|WR|TE)$/)?.[1];
      if (row.teamPosition && !listedPosition) return;
      const line = Number(row.line);
      if (!Number.isFinite(line)) throw new Error(`Invalid PrizePicks line: ${row.line}`);
      const player = rosterByName.get(normalizeName(row.playerName));
      if (!player) throw new Error(`Player is not in the verified NFL roster index: ${row.playerName}`);
      if (listedPosition && player.position !== listedPosition) throw new Error(`PrizePicks position does not match the verified roster: ${row.playerName}`);
      const statType = prizePicksStatType(row.statLabel, player.position);
      if (!statType) throw new Error(`Unsupported PrizePicks stat label: ${row.statLabel}`);
      const marketScope = row.marketScope === "week_1" ? "week_1" : "regular_season";
      const key = `${season}:${marketScope}:${statType}:${player.id}`;
      if (seen.has(key)) throw new Error(`Duplicate PrizePicks projection: ${row.playerName} ${row.statLabel}`);
      seen.add(key);
      observations.push({
        source: PRIZEPICKS_SOURCE.id,
        sourceName: PRIZEPICKS_SOURCE.name,
        sourceUrl,
        season,
        capturedAt,
        player,
        marketScope,
        statType,
        line,
        isMain: true,
        evidenceHash: hash(JSON.stringify(row)),
      });
    } catch (error) {
      errors.push(`row ${index + 1}: ${error.message}`);
    }
  });

  const foundStats = new Set(observations.filter((observation) => observation.marketScope === "regular_season").map((observation) => observation.statType));
  for (const statType of requiredStatTypes) {
    if (!foundStats.has(statType)) errors.push(`Required PrizePicks stat is missing: ${statType}`);
  }
  return { observations, errors };
}
