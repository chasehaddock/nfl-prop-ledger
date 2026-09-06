import { createHash } from "node:crypto";
import { normalizeName } from "../../lib/ledger.mjs";
import { UNDERDOG_SOURCE } from "../underdog-config.mjs";

const STAT_LABELS = new Map([
  ["pass yards", "passing_yards"],
  ["passing yards", "passing_yards"],
  ["pass tds", "passing_touchdowns"],
  ["passing tds", "passing_touchdowns"],
  ["rush yards", "rushing_yards"],
  ["rushing yards", "rushing_yards"],
  ["rec yards", "receiving_yards"],
  ["receiving yards", "receiving_yards"],
  ["receptions", "receptions"],
  ["rush + rec tds", "offensive_touchdowns"],
  ["rush+rec tds", "offensive_touchdowns"],
]);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validMultiplier(value) {
  return Number.isFinite(value) && value >= 0.25 && value <= 10;
}

export function underdogNormalizedProbability(higherMultiplier, lowerMultiplier) {
  if (!validMultiplier(higherMultiplier) || !validMultiplier(lowerMultiplier)) return Number.NaN;
  const higherWeight = 1 / higherMultiplier;
  const lowerWeight = 1 / lowerMultiplier;
  return higherWeight / (higherWeight + lowerWeight);
}

export function underdogStatType(value) {
  return STAT_LABELS.get(String(value).replace(/\s+/g, " ").trim().toLowerCase()) || null;
}

export function parseUnderdogRows(rows, { rosterByName, sourceUrl, capturedAt, season, requiredStatTypes = [] }) {
  const observations = [];
  const errors = [];
  const seen = new Set();

  rows.forEach((row, index) => {
    try {
      if (row.isNonStandard === true) return;
      const statType = underdogStatType(row.statLabel);
      if (!statType) throw new Error(`Unsupported Underdog stat label: ${row.statLabel}`);
      const line = Number(row.line);
      const higherMultiplier = row.higherMultiplier === undefined ? undefined : Number(row.higherMultiplier);
      const lowerMultiplier = row.lowerMultiplier === undefined ? undefined : Number(row.lowerMultiplier);
      if (!Number.isFinite(line)) throw new Error(`Invalid Underdog line: ${row.line}`);
      if (higherMultiplier === undefined || lowerMultiplier === undefined) throw new Error("Underdog Week 1 rows require both Higher and Lower multipliers");
      if (!validMultiplier(higherMultiplier) || !validMultiplier(lowerMultiplier)) throw new Error("Higher and Lower multipliers must both be valid");
      const normalizedProbability = underdogNormalizedProbability(higherMultiplier, lowerMultiplier);
      if (!Number.isFinite(normalizedProbability) || normalizedProbability <= 0 || normalizedProbability >= 1) throw new Error("Normalized probability is invalid");
      const player = rosterByName.get(normalizeName(row.playerName));
      if (!player) throw new Error(`Player is not in the verified NFL roster index: ${row.playerName}`);
      const key = `${season}:week_1:${statType}:${player.id}`;
      if (seen.has(key)) throw new Error(`Duplicate Underdog projection: ${row.playerName} ${row.statLabel}`);
      seen.add(key);
      observations.push({
        source: UNDERDOG_SOURCE.id,
        sourceName: UNDERDOG_SOURCE.name,
        sourceUrl: row.sourceUrl || sourceUrl,
        season,
        capturedAt,
        player,
        marketScope: "week_1",
        statType,
        line,
        higherMultiplier,
        lowerMultiplier,
        normalizedProbability,
        isMain: true,
        evidenceHash: hash(JSON.stringify(row)),
      });
    } catch (error) {
      errors.push(`row ${index + 1}: ${error.message}`);
    }
  });

  const foundStats = new Set(observations.map((observation) => observation.statType));
  for (const statType of requiredStatTypes) {
    if (!foundStats.has(statType)) errors.push(`Required Underdog stat is missing: ${statType}`);
  }
  return { observations, errors };
}
