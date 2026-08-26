import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseBetMgmRows } from "../collector/adapters/betmgm.mjs";
import { parseDraftKingsRows } from "../collector/adapters/draftkings.mjs";
import { parseFanDuelRows } from "../collector/adapters/fanduel.mjs";
import { parsePrizePicksRows } from "../collector/adapters/prizepicks.mjs";
import { parseUnderdogRows } from "../collector/adapters/underdog.mjs";
import { BETMGM_MARKETS, BETMGM_REQUIRED_STAT_TYPES, BETMGM_SOURCE } from "../collector/betmgm-config.mjs";
import { DRAFTKINGS_MARKETS, DRAFTKINGS_SOURCE } from "../collector/draftkings-config.mjs";
import { FANDUEL_MARKETS, FANDUEL_REQUIRED_STAT_TYPES, FANDUEL_SOURCE } from "../collector/fanduel-config.mjs";
import { PRIZEPICKS_MARKETS, PRIZEPICKS_REQUIRED_STAT_TYPES, PRIZEPICKS_SOURCE } from "../collector/prizepicks-config.mjs";
import { UNDERDOG_MARKETS, UNDERDOG_REQUIRED_STAT_TYPES, UNDERDOG_SOURCE } from "../collector/underdog-config.mjs";
import { loadRoster } from "../collector/roster.mjs";

const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile || !outputFile) {
  console.error("Usage: node scripts/process-browser-capture.mjs INPUT_RAW.json OUTPUT.json");
  process.exit(1);
}

const raw = JSON.parse(await readFile(inputFile, "utf8"));
const adapters = new Map([
  [DRAFTKINGS_SOURCE.id, {
    source: DRAFTKINGS_SOURCE,
    markets: DRAFTKINGS_MARKETS,
    parse: (page, spec, rosterByName) => parseDraftKingsRows(page.rows, {
      rosterByName,
      sourceUrl: spec.url,
      expectedStatType: spec.statType,
      capturedAt: page.capturedAt || raw.capturedAt,
    }),
  }],
  [FANDUEL_SOURCE.id, {
    source: FANDUEL_SOURCE,
    markets: FANDUEL_MARKETS,
    parse: (page, spec, rosterByName) => parseFanDuelRows(page.rows, {
      rosterByName,
      sourceUrl: spec.url,
      capturedAt: page.capturedAt || raw.capturedAt,
      season: raw.season,
      requiredStatTypes: FANDUEL_REQUIRED_STAT_TYPES,
    }),
  }],
  [BETMGM_SOURCE.id, {
    source: BETMGM_SOURCE,
    markets: BETMGM_MARKETS,
    parse: (page, spec, rosterByName) => parseBetMgmRows(page.rows, {
      rosterByName,
      sourceUrl: spec.url,
      capturedAt: page.capturedAt || raw.capturedAt,
      season: raw.season,
      requiredStatTypes: BETMGM_REQUIRED_STAT_TYPES,
    }),
  }],
  [PRIZEPICKS_SOURCE.id, {
    source: PRIZEPICKS_SOURCE,
    markets: PRIZEPICKS_MARKETS,
    parse: (page, spec, rosterByName) => parsePrizePicksRows(page.rows, {
      rosterByName,
      sourceUrl: spec.url,
      capturedAt: page.capturedAt || raw.capturedAt,
      season: raw.season,
      requiredStatTypes: PRIZEPICKS_REQUIRED_STAT_TYPES,
    }),
  }],
  [UNDERDOG_SOURCE.id, {
    source: UNDERDOG_SOURCE,
    markets: UNDERDOG_MARKETS,
    parse: (page, spec, rosterByName) => parseUnderdogRows(page.rows, {
      rosterByName,
      sourceUrl: spec.url,
      capturedAt: page.capturedAt || raw.capturedAt,
      season: raw.season,
      requiredStatTypes: UNDERDOG_REQUIRED_STAT_TYPES,
    }),
  }],
]);

const adapter = adapters.get(raw.source);
if (!adapter || !Number.isInteger(raw.season) || !Array.isArray(raw.pages)) throw new Error("Invalid browser capture envelope");
const rosterByName = await loadRoster(raw.season);
const pages = new Map(raw.pages.map((page) => [page.id, page]));
const observations = [];

for (const spec of adapter.markets) {
  const page = pages.get(spec.id);
  if (!page || page.url !== spec.url || !Array.isArray(page.rows) || page.rows.length === 0) throw new Error(`${spec.id}: required page is missing or empty`);
  const result = adapter.parse(page, spec, rosterByName);
  if (result.errors.length) throw new Error(`${spec.id}: ${result.errors.join("; ")}`);
  observations.push(...result.observations);
}
if (observations.some((observation) => observation.season !== raw.season)) throw new Error("Captured market season does not match the capture envelope");

const capture = {
  source: adapter.source.id,
  sourceName: adapter.source.name,
  providerType: adapter.source.providerType,
  season: raw.season,
  capturedAt: raw.capturedAt,
  complete: true,
  observations,
  evidenceHash: createHash("sha256").update(JSON.stringify(raw.pages)).digest("hex"),
};
await writeFile(outputFile, `${JSON.stringify(capture, null, 2)}\n`);
console.log(`Validated ${observations.length} observations from ${inputFile}.`);
