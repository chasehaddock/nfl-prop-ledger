import { createHash } from "node:crypto";
import { normalizeName } from "../../lib/ledger.mjs";
import { BETMGM_SOURCE } from "../betmgm-config.mjs";
import { parseAmericanOdds } from "./american-odds.mjs";

const STAT_LABELS = new Map([
  ["passing yards o/u", "passing_yards"],
  ["passing tds", "passing_touchdowns"],
  ["rushing yards o/u", "rushing_yards"],
  ["rushing tds", "rushing_touchdowns"],
  ["receiving yards o/u", "receiving_yards"],
  ["receiving tds", "receiving_touchdowns"],
]);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function playerLookupName(value) {
  return String(value).trim().replace(/\s+\([A-Z]{2,3}\)$/i, "");
}

export function parseBetMgmOutcome(value) {
  const match = String(value).trim().match(/^(O|U)\s+(\d+(?:\.\d+)?)$/i);
  if (!match) throw new Error(`Invalid BetMGM outcome title: ${value}`);
  return { side: match[1].toLowerCase() === "o" ? "over" : "under", line: Number(match[2]) };
}

export function parseBetMgmRows(rows, { rosterByName, sourceUrl, capturedAt, season, requiredStatTypes = [] }) {
  const observations = [];
  const errors = [];
  const seen = new Set();

  rows.forEach((row, index) => {
    try {
      const statType = STAT_LABELS.get(String(row.statLabel).trim().toLowerCase());
      if (!statType) throw new Error(`Unsupported BetMGM stat label: ${row.statLabel}`);
      if (!Array.isArray(row.outcomes) || row.outcomes.length !== 2) throw new Error("Expected exactly two outcomes");
      const parsed = row.outcomes.map((outcome) => ({
        ...parseBetMgmOutcome(outcome.title),
        odds: parseAmericanOdds(outcome.odds),
      }));
      const over = parsed.find((outcome) => outcome.side === "over");
      const under = parsed.find((outcome) => outcome.side === "under");
      if (!over || !under || over.line !== under.line) throw new Error("Over and under must have the same line");
      const player = rosterByName.get(normalizeName(playerLookupName(row.playerName)));
      if (!player) throw new Error(`Player is not in the verified NFL roster index: ${row.playerName}`);
      const key = `${season}:${statType}:${player.id}`;
      if (seen.has(key)) throw new Error(`Duplicate BetMGM main market: ${row.playerName} ${row.statLabel}`);
      seen.add(key);
      observations.push({
        source: BETMGM_SOURCE.id,
        sourceName: BETMGM_SOURCE.name,
        sourceUrl,
        season,
        capturedAt,
        player,
        marketScope: "regular_season",
        statType,
        line: over.line,
        overOdds: over.odds,
        underOdds: under.odds,
        isMain: true,
        evidenceHash: hash(JSON.stringify(row)),
      });
    } catch (error) {
      errors.push(`row ${index + 1}: ${error.message}`);
    }
  });

  const foundStats = new Set(observations.map((observation) => observation.statType));
  for (const statType of requiredStatTypes) {
    if (!foundStats.has(statType)) errors.push(`Required BetMGM stat is missing: ${statType}`);
  }
  return { observations, errors };
}
