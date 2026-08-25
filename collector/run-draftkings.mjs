import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { collectDraftKingsMarket } from "./adapters/draftkings.mjs";
import { DRAFTKINGS_MARKETS, DRAFTKINGS_SOURCE } from "./draftkings-config.mjs";
import { loadRoster } from "./roster.mjs";

const season = Number(process.env.NFL_SEASON || new Date().getFullYear());
const headless = process.env.COLLECTOR_HEADFUL !== "1";
const profileDir = path.resolve(".private/chrome-profile");

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function collectPass(page, rosterByName) {
  const observations = [];
  const counts = {};
  let capturedAt = new Date().toISOString();
  for (const spec of DRAFTKINGS_MARKETS) {
    const result = await collectDraftKingsMarket(page, spec, rosterByName);
    capturedAt = result.capturedAt;
    counts[spec.id] = result.rowCount;
    observations.push(...result.observations);
  }
  return {
    source: DRAFTKINGS_SOURCE.id,
    sourceName: DRAFTKINGS_SOURCE.name,
    providerType: DRAFTKINGS_SOURCE.providerType,
    season,
    capturedAt,
    complete: true,
    marketCounts: counts,
    observations,
    evidenceHash: hash(JSON.stringify(observations.map((item) => item.evidenceHash))),
  };
}

await mkdir(profileDir, { recursive: true });
const rosterByName = await loadRoster(season);
const context = await chromium.launchPersistentContext(profileDir, {
  channel: "chrome",
  headless,
  locale: "en-US",
  timezoneId: "America/Denver",
  geolocation: { latitude: 39.7392, longitude: -104.9903 },
  permissions: ["geolocation"],
  viewport: { width: 1440, height: 1000 },
});

try {
  const page = context.pages()[0] || await context.newPage();
  const primary = await collectPass(page, rosterByName);
  await page.waitForTimeout(2_000);
  const confirmation = await collectPass(page, rosterByName);
  const date = confirmation.capturedAt.slice(0, 10);
  const incomingDir = path.resolve("data/incoming", date);
  await mkdir(incomingDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(incomingDir, "draftkings-primary.json"), `${JSON.stringify(primary, null, 2)}\n`),
    writeFile(path.join(incomingDir, "draftkings-confirmation.json"), `${JSON.stringify(confirmation, null, 2)}\n`),
  ]);
  console.log(`${primary.observations.length} DraftKings observations captured twice for ${date}.`);
} finally {
  await context.close();
}
