import { createHash } from "node:crypto";
import { normalizeName } from "../../lib/ledger.mjs";
import { FANDUEL_SOURCE } from "../fanduel-config.mjs";
import { parseAmericanOdds } from "./american-odds.mjs";

const SEASON_OUTCOME_PATTERN = /^(.+?) Regular Season (Passing Yards|Passing TDs|Rushing Yards|Rushing TDs|Receiving Yards|Receiving TDs|Receptions) (\d{4})-\d{2}, (.+?) (Over|Under) (\d+(?:\.\d+)?), ([+−–—-]?\d+)$/i;
const WEEKLY_OUTCOME_PATTERN = /^(.+?) - (Passing (?:Yards|Yds)|Passing TDs|Rushing (?:Yards|Yds)|Receiving (?:Yards|Yds)|Total Receptions|Receptions), (.+?) (Over|Under), (\d+(?:\.\d+)?), ([+−–—-]?\d+)$/i;
const STAT_LABELS = new Map([
  ["passing yards", "passing_yards"],
  ["passing yds", "passing_yards"],
  ["passing tds", "passing_touchdowns"],
  ["rushing yards", "rushing_yards"],
  ["rushing yds", "rushing_yards"],
  ["rushing tds", "rushing_touchdowns"],
  ["receiving yards", "receiving_yards"],
  ["receiving yds", "receiving_yards"],
  ["receiving tds", "receiving_touchdowns"],
  ["receptions", "receptions"],
  ["total receptions", "receptions"],
]);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseFanDuelOutcomeLabel(value, { season } = {}) {
  const label = String(value).trim();
  const seasonMatch = label.match(SEASON_OUTCOME_PATTERN);
  if (seasonMatch) {
    if (normalizeName(seasonMatch[1]) !== normalizeName(seasonMatch[4])) {
      throw new Error(`FanDuel player labels do not match: ${seasonMatch[1]} / ${seasonMatch[4]}`);
    }
    return {
      playerName: seasonMatch[1].trim(),
      statType: STAT_LABELS.get(seasonMatch[2].toLowerCase()),
      season: Number(seasonMatch[3]),
      marketScope: "regular_season",
      side: seasonMatch[5].toLowerCase(),
      line: Number(seasonMatch[6]),
      odds: parseAmericanOdds(seasonMatch[7]),
    };
  }

  const weeklyMatch = label.match(WEEKLY_OUTCOME_PATTERN);
  if (!weeklyMatch) throw new Error(`Unrecognized FanDuel outcome label: ${value}`);
  if (!Number.isInteger(season)) throw new Error("FanDuel Week 1 outcome is missing its season");
  if (normalizeName(weeklyMatch[1]) !== normalizeName(weeklyMatch[3])) {
    throw new Error(`FanDuel player labels do not match: ${weeklyMatch[1]} / ${weeklyMatch[3]}`);
  }
  return {
    playerName: weeklyMatch[1].trim(),
    statType: STAT_LABELS.get(weeklyMatch[2].toLowerCase()),
    season,
    marketScope: "week_1",
    side: weeklyMatch[4].toLowerCase(),
    line: Number(weeklyMatch[5]),
    odds: parseAmericanOdds(weeklyMatch[6]),
  };
}

export function parseFanDuelRows(rows, { rosterByName, sourceUrl, capturedAt, season, requiredStatTypes = [] }) {
  const groups = new Map();
  const errors = [];

  rows.forEach((row, index) => {
    try {
      const parsed = parseFanDuelOutcomeLabel(row.ariaLabel, { season });
      const key = `${parsed.marketScope}:${parsed.season}:${parsed.statType}:${normalizeName(parsed.playerName)}`;
      const group = groups.get(key) || [];
      group.push({ ...parsed, raw: row });
      groups.set(key, group);
    } catch (error) {
      errors.push(`row ${index + 1}: ${error.message}`);
    }
  });

  const observations = [];
  for (const [key, outcomes] of groups) {
    try {
      if (outcomes.length !== 2) throw new Error("Expected exactly two outcomes");
      const over = outcomes.find((outcome) => outcome.side === "over");
      const under = outcomes.find((outcome) => outcome.side === "under");
      if (!over || !under || over.line !== under.line) throw new Error("Over and under must have the same line");
      const player = rosterByName.get(normalizeName(over.playerName));
      if (!player) throw new Error(`Player is not in the verified NFL roster index: ${over.playerName}`);
      observations.push({
        source: FANDUEL_SOURCE.id,
        sourceName: FANDUEL_SOURCE.name,
        sourceUrl: over.raw.sourceUrl || sourceUrl,
        season: over.season,
        capturedAt,
        player,
        marketScope: over.marketScope,
        statType: over.statType,
        line: over.line,
        overOdds: over.odds,
        underOdds: under.odds,
        isMain: true,
        evidenceHash: hash(JSON.stringify(outcomes.map((outcome) => outcome.raw))),
      });
    } catch (error) {
      errors.push(`${key}: ${error.message}`);
    }
  }

  const foundStats = new Set(observations.filter((observation) => observation.marketScope === "week_1").map((observation) => observation.statType));
  for (const statType of requiredStatTypes) {
    if (!foundStats.has(statType)) errors.push(`Required FanDuel Week 1 stat is missing: ${statType}`);
  }
  return { observations, errors };
}
