import { createHash } from "node:crypto";
import { normalizeName } from "../../lib/ledger.mjs";
import { DRAFTKINGS_SOURCE } from "../draftkings-config.mjs";
import { parseAmericanOdds } from "./american-odds.mjs";

export { parseAmericanOdds } from "./american-odds.mjs";

const LABEL_PATTERN = /^NFL\s+(\d{4})\/\d{2}\s+[-–—]\s+(.+?)\s+Regular Season\s+(.+)$/i;
const STAT_LABELS = new Map([
  ["passing yards", "passing_yards"],
  ["passing touchdowns", "passing_touchdowns"],
  ["passing tds", "passing_touchdowns"],
  ["receiving yards", "receiving_yards"],
  ["receiving touchdowns", "receiving_touchdowns"],
  ["receiving tds", "receiving_touchdowns"],
  ["receptions", "receptions"],
  ["rushing yards", "rushing_yards"],
  ["rushing touchdowns", "rushing_touchdowns"],
  ["rushing tds", "rushing_touchdowns"],
]);

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseOutcomeTitle(value) {
  const match = String(value).trim().match(/^(Over|Under)\s+(\d+(?:\.\d+)?)$/i);
  if (!match) throw new Error(`Invalid outcome title: ${value}`);
  return { side: match[1].toLowerCase(), line: Number(match[2]) };
}

export function parseMarketLabel(label) {
  const match = String(label).trim().match(LABEL_PATTERN);
  if (!match) throw new Error(`Unrecognized DraftKings market label: ${label}`);
  const statType = STAT_LABELS.get(match[3].trim().toLowerCase());
  if (!statType) throw new Error(`Unsupported DraftKings stat label: ${match[3]}`);
  return { season: Number(match[1]), playerName: match[2].trim(), statType };
}

export function parseDraftKingsRows(rows, { rosterByName, sourceUrl, expectedStatType, capturedAt }) {
  const observations = [];
  const errors = [];

  rows.forEach((row, index) => {
    if (!row.label && Array.isArray(row.outcomes) && row.outcomes.length === 0) return;
    try {
      const market = parseMarketLabel(row.label);
      if (market.statType !== expectedStatType) {
        throw new Error(`Expected ${expectedStatType}, found ${market.statType}`);
      }
      if (!Array.isArray(row.outcomes) || row.outcomes.length !== 2) {
        throw new Error("Expected exactly two outcomes");
      }

      const parsed = row.outcomes.map((outcome) => ({
        ...parseOutcomeTitle(outcome.title),
        odds: parseAmericanOdds(outcome.odds),
      }));
      const over = parsed.find((outcome) => outcome.side === "over");
      const under = parsed.find((outcome) => outcome.side === "under");
      if (!over || !under || over.line !== under.line) {
        throw new Error("Over and under must have the same line");
      }

      const player = rosterByName.get(normalizeName(market.playerName));
      if (!player) throw new Error(`Player is not in the verified NFL roster index: ${market.playerName}`);

      observations.push({
        source: DRAFTKINGS_SOURCE.id,
        sourceName: DRAFTKINGS_SOURCE.name,
        sourceUrl,
        season: market.season,
        capturedAt,
        player,
        marketScope: "regular_season",
        statType: market.statType,
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

  return { observations, errors };
}

export async function readDraftKingsRows(page) {
  return page.locator('[data-testid="market-template"]').evaluateAll((markets) => markets.map((market) => ({
    label: market.querySelector('[data-testid="market-label"] p')?.textContent?.trim() || "",
    outcomes: [...market.querySelectorAll("button")].map((button) => ({
      title: button.querySelector('[data-testid="button-title-market-board"]')?.textContent?.trim() || "",
      odds: button.querySelector('[data-testid="button-odds-market-board"]')?.textContent?.trim() || "",
    })),
  })));
}

export async function collectDraftKingsMarket(page, spec, rosterByName) {
  await page.goto(spec.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1_500);
  const body = await page.locator("body").innerText();
  if (/No Available Bets/i.test(body)) {
    throw new Error(`${spec.id}: DraftKings returned No Available Bets; location/session must be repaired`);
  }
  await page.locator('[data-testid="market-template"]').first().waitFor({ state: "visible", timeout: 25_000 });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });

  const capturedAt = new Date().toISOString();
  const rows = await readDraftKingsRows(page);
  if (rows.length === 0) throw new Error(`${spec.id}: no markets were found`);
  const parsed = parseDraftKingsRows(rows, {
    rosterByName,
    sourceUrl: spec.url,
    expectedStatType: spec.statType,
    capturedAt,
  });
  if (parsed.errors.length) throw new Error(`${spec.id}: ${parsed.errors.join("; ")}`);
  return { capturedAt, observations: parsed.observations, rowCount: rows.length };
}
