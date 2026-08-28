import { isRunLeaseActive } from "./run-state.js";

const DRAFTKINGS_BASE = "https://sportsbook.draftkings.com/leagues/football/nfl?category=futures&subcategory=player-stats-o-u";
const SLEEPER_DRAFT_URL = "https://sleeper.com/draft/nfl/1397766719740620800?ftue=commish";
const SOURCES = [
  {
    id: "draftkings",
    name: "DraftKings",
    scraper: "draftkings",
    pages: [
      ["pass-yards", "passing_yards"],
      ["pass-tds", "passing_touchdowns"],
      ["rec-yards", "receiving_yards"],
      ["rec-tds", "receiving_touchdowns"],
      ["receptions", "receptions"],
      ["rush-yards", "rushing_yards"],
      ["rush-tds", "rushing_touchdowns"],
    ].map(([id, statType]) => ({ id, statType, url: `${DRAFTKINGS_BASE}&nav_1=${id}` })),
  },
  {
    id: "fanduel",
    name: "FanDuel",
    scraper: "fanduel",
    requiredStatLabels: ["Passing Yards", "Passing TDs", "Rushing Yards", "Rushing TDs", "Receiving Yards"],
    pages: [{ id: "player-props", url: "https://sportsbook.fanduel.com/navigation/nfl?tab=player-props" }],
  },
  {
    id: "prizepicks",
    name: "PrizePicks",
    scraper: "prizepicks",
    season: () => {
      const now = new Date();
      return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
    },
    requiredStatLabels: ["Pass Yards", "Rush Yards", "Rec Yards"],
    pages: [{ id: "nfl-season", url: "https://app.prizepicks.com/" }],
  },
  {
    id: "underdog",
    name: "Underdog",
    scraper: "underdog",
    season: () => new Date().getFullYear(),
    requiredStatLabels: ["Pass TDs", "Receptions", "Rush + Rec TDs"],
    pages: [{ id: "nfl-week-1-player-props", url: "https://app.underdogsports.com/pick-em/higher-lower/all/NFL" }],
  },
  {
    id: "sleeper",
    name: "Sleeper ADP",
    scraper: "sleeper",
    season: () => new Date().getFullYear(),
    pages: [{ id: "redraft-adp", url: SLEEPER_DRAFT_URL }],
  },
];

async function disableLegacyAutomaticCapture() {
  await chrome.alarms.clear("daily-capture");
}

async function waitForTab(tabId) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Sportsbook page did not finish loading");
}

function isScraperPageReady(scraper) {
  const bodyText = document.body?.innerText || "";
  if (/not available in your location|unable to display/i.test(bodyText)) return true;
  if (scraper === "draftkings") {
    return Boolean(document.querySelector('[data-testid="market-template"]')) || /No Available Bets/i.test(bodyText);
  }
  if (scraper === "fanduel") {
    return [...document.querySelectorAll('[role="button"][aria-label], h3')]
      .some((element) => /(?:Regular Season (?:Passing|Rushing|Receiving)| - (?:Passing|Rushing|Receiving|Total Receptions))/i
        .test(element.getAttribute("aria-label") || element.textContent || ""));
  }
  if (scraper === "prizepicks") {
    return [...document.querySelectorAll('[role="tab"], button')]
      .some((element) => /^(?:NFLSZN|NFL)$/.test(element.textContent?.trim() || ""))
      || /Where are you\?/i.test(bodyText);
  }
  if (scraper === "underdog") {
    const labels = new Set([...document.querySelectorAll('button, [role="button"]')]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.textContent?.replace(/\s+/g, " ").trim() || ""));
    return ["TD Scorers", "Passing", "Receiving"].some((label) => labels.has(label));
  }
  if (scraper === "sleeper") {
    return Boolean(document.querySelector('[role="grid"]'))
      && /Redraft league PPR 4pt passing/i.test(bodyText);
  }
  return document.readyState === "complete";
}

async function waitForScraperPage(tabId, scraper, timeoutMilliseconds = 12_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: isScraperPageReady,
      args: [scraper],
    });
    if (results[0]?.result) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${scraper} page did not become ready for capture`);
}

function scrapeDraftKingsPage() {
  const rows = [...document.querySelectorAll('[data-testid="market-template"]')].map((market) => ({
    label: market.querySelector('[data-testid="market-label"] p')?.textContent?.trim() || "",
    outcomes: [...market.querySelectorAll("button")].map((button) => ({
      title: button.querySelector('[data-testid="button-title-market-board"]')?.textContent?.trim() || "",
      odds: button.querySelector('[data-testid="button-odds-market-board"]')?.textContent?.trim() || "",
    })),
  }));
  return { rows, marketCount: rows.filter((row) => row.label).length, unavailable: /No Available Bets/i.test(document.body.innerText) };
}

async function scrapeFanDuelPage() {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const seasonCardPattern = /^.+ Regular Season (Passing Yards|Passing TDs|Rushing Yards|Rushing TDs|Receiving Yards|Receiving TDs|Receptions) 20\d{2}-\d{2}$/i;
  const weeklyCardPattern = /^.+ - (Passing Yards|Passing TDs|Rushing Yards|Receiving Yards|Total Receptions|Receptions)$/i;
  const outcomePattern = /(?: Regular Season (?:Passing Yards|Passing TDs|Rushing Yards|Rushing TDs|Receiving Yards|Receiving TDs|Receptions) 20\d{2}-\d{2}| - (?:Passing Yards|Passing TDs|Rushing Yards|Receiving Yards|Total Receptions|Receptions)), .+ (?:Over|Under)(?:,)? \d/i;
  const discoverMarketLabels = () => new Set(
    [...document.querySelectorAll('[role="button"], h3')]
      .map((element) => element.getAttribute("aria-label")?.split(",")[0]?.trim() || element.textContent.trim())
      .filter((label) => seasonCardPattern.test(label) || weeklyCardPattern.test(label)),
  );

  window.scrollTo(0, 0);
  await sleep(250);
  let marketLabels = discoverMarketLabels();
  let stableChecks = 0;
  let priorHeight = 0;
  for (let attempt = 0; attempt < 200 && stableChecks < 8; attempt += 1) {
    window.scrollBy(0, Math.max(window.innerHeight * 0.75, 500));
    await sleep(100);
    const discovered = discoverMarketLabels();
    const height = document.documentElement.scrollHeight;
    const atBottom = window.scrollY + window.innerHeight >= height - 10;
    stableChecks = atBottom && discovered.size === marketLabels.size && height === priorHeight ? stableChecks + 1 : 0;
    marketLabels = discovered;
    priorHeight = height;
  }
  window.scrollTo(0, 0);
  await sleep(250);

  const outcomesByMarket = new Map();
  const readOutcomeIndex = () => {
    const index = new Map();
    for (const element of document.querySelectorAll('[role="button"][aria-label]')) {
      const label = element.getAttribute("aria-label")?.trim() || "";
      if (!outcomePattern.test(label)) continue;
      const separator = label.indexOf(", ");
      if (separator < 0) continue;
      const marketLabel = label.slice(0, separator);
      if (!marketLabels.has(marketLabel)) continue;
      const outcomes = index.get(marketLabel) || [];
      outcomes.push(label);
      index.set(marketLabel, outcomes);
    }
    return index;
  };
  const findCard = (marketLabel) => [...document.querySelectorAll('[role="button"]:not([aria-label])')]
    .find((element) => element.textContent.trim() === marketLabel);
  let outcomeIndex = readOutcomeIndex();
  const pendingLabels = [...marketLabels].filter((marketLabel) => {
    const outcomes = outcomeIndex.get(marketLabel) || [];
    if (outcomes.length !== 2) return true;
    outcomesByMarket.set(marketLabel, outcomes);
    return false;
  });
  const batchSize = 12;
  for (let offset = 0; offset < pendingLabels.length; offset += batchSize) {
    const batch = pendingLabels.slice(offset, offset + batchSize);
    const cards = batch.map((marketLabel) => findCard(marketLabel));
    if (cards.some((card) => !card)) {
      return { rows: [], marketCount: outcomesByMarket.size, expectedMarketCount: marketLabels.size, unavailable: false };
    }
    for (const card of cards) card.click();
    outcomeIndex = readOutcomeIndex();
    for (let attempt = 0; attempt < 30 && !batch.every((marketLabel) => (outcomeIndex.get(marketLabel) || []).length === 2); attempt += 1) {
      await sleep(50);
      outcomeIndex = readOutcomeIndex();
    }
    for (const marketLabel of batch) {
      let outcomes = outcomeIndex.get(marketLabel) || [];
      if (outcomes.length === 2) {
        outcomesByMarket.set(marketLabel, outcomes);
        continue;
      }
      const card = findCard(marketLabel);
      card.click();
      for (let attempt = 0; attempt < 20 && outcomes.length !== 2; attempt += 1) {
        await sleep(50);
        outcomeIndex = readOutcomeIndex();
        outcomes = outcomeIndex.get(marketLabel) || [];
      }
      if (outcomes.length !== 2) {
        return { rows: [], marketCount: outcomesByMarket.size, expectedMarketCount: marketLabels.size, unavailable: false };
      }
      outcomesByMarket.set(marketLabel, outcomes);
    }
  }

  outcomeIndex = readOutcomeIndex();
  for (const marketLabel of marketLabels) {
    const outcomes = outcomeIndex.get(marketLabel) || [];
    if (outcomes.length !== 2) {
      return { rows: [], marketCount: outcomesByMarket.size, expectedMarketCount: marketLabels.size, unavailable: false };
    }
    outcomesByMarket.set(marketLabel, outcomes);
  }

  const labels = [...outcomesByMarket.values()].flat();
  const statLabels = [...new Set([...marketLabels].map((label) => label.match(seasonCardPattern)?.[1]).filter(Boolean))];
  return {
    rows: labels.map((ariaLabel) => ({ ariaLabel })),
    marketCount: outcomesByMarket.size,
    expectedMarketCount: marketLabels.size,
    statLabels,
    unavailable: /unable to display|not available in your location/i.test(document.body.innerText),
  };
}

async function scrapePrizePicksPage() {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const supportedLabels = new Map([
    ["passing yards", "Pass Yards"], ["pass yards", "Pass Yards"],
    ["passing touchdowns", "Pass TDs"], ["passing tds", "Pass TDs"], ["pass tds", "Pass TDs"],
    ["rushing yards", "Rush Yards"], ["rush yards", "Rush Yards"],
    ["rushing touchdowns", "Rush TDs"], ["rushing tds", "Rush TDs"], ["rush tds", "Rush TDs"],
    ["receiving yards", "Rec Yards"], ["rec yards", "Rec Yards"],
    ["receiving touchdowns", "Rec TDs"], ["receiving tds", "Rec TDs"], ["rec tds", "Rec TDs"],
    ["receptions", "Receptions"], ["recs", "Receptions"], ["rec", "Receptions"],
    ["fantasy score", "Fantasy Score"],
    ["rush+rec tds", "Rush+Rec TDs"], ["rush + rec tds", "Rush+Rec TDs"],
    ["rushing + receiving touchdowns", "Rush+Rec TDs"], ["player touchdowns", "Rush+Rec TDs"],
  ]);
  const text = (element) => element?.textContent?.replace(/\s+/g, " ").trim() || "";
  const normalizedLabel = (value) => value.replace(/^SZN\s+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
  const canonicalLabel = (value) => supportedLabels.get(normalizedLabel(value));
  const locationBlocked = () => /Where are you\?[\s\S]*allow ['’]Location['’]/i.test(document.body.innerText);
  const waitForLocation = async () => {
    for (let attempt = 0; attempt < 75 && locationBlocked(); attempt += 1) await sleep(200);
    return !locationBlocked();
  };

  const privacyClose = [...document.querySelectorAll("button")].find((button) => /close banner/i.test(button.getAttribute("aria-label") || ""));
  if (privacyClose) privacyClose.click();
  const introClose = [...document.querySelectorAll("button")].find((button) => text(button) === "Got it");
  if (introClose) introClose.click();
  await sleep(250);

  if (!await waitForLocation()) return { rows: [], marketCount: 0, statLabels: [], unavailable: true, unavailableReason: "PrizePicks needs Chrome location permission" };
  const rowsByKey = new Map();
  const seasonStatLabels = new Set();
  const projectionRows = () => [...document.querySelectorAll(
    '#test-projection-li, [aria-label="Projections List"] > li, [data-testid="projection-card"], [data-testid="projection-list"] > li',
  )];
  const readRows = (statLabel, marketScope) => projectionRows().map((row) => ({
    playerName: text(row.querySelector('#test-player-name, [data-testid="player-name"], [class*="player-name"]')),
    teamPosition: text(row.querySelector('#test-team-position, [data-testid="team-position"], [class*="team-position"]')),
    line: text(row.querySelector('.heading-md, [data-testid="projection-line"], [class*="projection-line"]')),
    displayedStatLabel: canonicalLabel(text(row.querySelector('.max-w-28, [data-testid="stat-type"], [class*="stat-type"]'))),
    statLabel,
    marketScope,
    isNonStandard: Boolean(row.querySelector('img[alt="Demon" i], img[alt="Goblin" i], [aria-label*="Demon" i], [aria-label*="Goblin" i]'))
      || /\b(?:Demon|Goblin)\b/i.test(text(row)),
  })).filter((row) => row.playerName
    && row.displayedStatLabel === statLabel
    && /^\d+(?:\.\d+)?$/.test(row.line)
    && /(?:^| - )(QB|RB|WR|TE)$/.test(row.teamPosition)
    && !row.isNonStandard);

  const captureBoard = async (leagueLabel, marketScope, required) => {
    const findLeagueTab = () => [...document.querySelectorAll('[role="tab"], button')]
      .find((tab) => text(tab) === leagueLabel && tab.getClientRects().length > 0);
    let leagueTab = findLeagueTab();
    if (!leagueTab) {
      if (required) throw new Error(`PrizePicks ${leagueLabel} tab is missing`);
      return;
    }
    if (leagueTab.getAttribute("aria-selected") !== "true") {
      leagueTab.scrollIntoView({ block: "nearest", inline: "center" });
      leagueTab.click();
      await sleep(700);
    }
    if (!await waitForLocation()) throw new Error("PrizePicks needs Chrome location permission");
    leagueTab = findLeagueTab();
    if (!leagueTab) throw new Error(`PrizePicks ${leagueLabel} tab disappeared`);

    const navigation = document.querySelector('[aria-label="Stats Navigation"]') || [...document.querySelectorAll("nav")]
      .find((nav) => [...nav.querySelectorAll("button")].some((button) => canonicalLabel(text(button))));
    if (!navigation) {
      if (required) throw new Error("PrizePicks statistic navigation is missing");
      return;
    }
    const statButtons = [...new Map([...navigation.querySelectorAll("button")]
      .map((button) => ({ rawLabel: text(button), label: canonicalLabel(text(button)) }))
      .filter((item) => item.label)
      .map((item) => [item.label, item])).values()];
    if (required && statButtons.length === 0) throw new Error("PrizePicks statistic buttons are missing");

    for (const { rawLabel, label } of statButtons) {
      const currentNavigation = document.querySelector('[aria-label="Stats Navigation"]')
        || [...document.querySelectorAll("nav")].find((nav) => [...nav.querySelectorAll("button")].some((candidate) => canonicalLabel(text(candidate))));
      const button = [...(currentNavigation?.querySelectorAll("button") || [])]
        .find((candidate) => canonicalLabel(text(candidate)) === label && text(candidate) === rawLabel);
      if (!button) {
        if (required) throw new Error(`PrizePicks statistic button disappeared: ${rawLabel}`);
        continue;
      }
      button.scrollIntoView({ block: "nearest", inline: "center" });
      button.click();
      let capturedRows = [];
      for (let attempt = 0; attempt < 45; attempt += 1) {
        capturedRows = readRows(label, marketScope);
        if (capturedRows.length) break;
        await sleep(120);
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(350);
      capturedRows = readRows(label, marketScope);
      for (const row of capturedRows) rowsByKey.set(`${marketScope}:${row.playerName}:${label}`, row);
      if (marketScope === "regular_season" && capturedRows.length) seasonStatLabels.add(label);
      window.scrollTo(0, 0);
    }
  };

  await captureBoard("NFLSZN", "regular_season", true);
  await captureBoard("NFL", "week_1", false);
  return {
    rows: [...rowsByKey.values()],
    marketCount: rowsByKey.size,
    statLabels: [...seasonStatLabels],
    unavailable: false,
  };
}

async function scrapeUnderdogPage() {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const text = (element) => element?.textContent?.replace(/\s+/g, " ").trim() || "";
  const supportedTabs = [
    { tab: "TD Scorers", statLabels: ["Rush + Rec TDs"] },
    { tab: "Passing", statLabels: ["Pass TDs"] },
    { tab: "Receiving", statLabels: ["Receptions"] },
  ];
  const rowsByKey = new Map();
  const statLabels = new Set();

  const visibleButtons = () => [...document.querySelectorAll('button, [role="button"]')]
    .filter((button) => button.getClientRects().length > 0);
  const findExactButton = (label) => visibleButtons().find((button) => text(button) === label);
  const modifier = (side) => {
    const value = text(side);
    const match = value.match(/(?:Higher|Lower)\s*(\d+(?:\.\d+)?)x/i);
    if (match) return Number(match[1]);
    return /^(?:Higher|Lower)$/i.test(value) ? 1 : Number.NaN;
  };
  const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const readVisibleCards = (supportedStatLabels) => {
    const cards = [...document.querySelectorAll('[role="button"]')].filter((card) => card.getClientRects().length > 0);
    for (const card of cards) {
      const cardText = text(card);
      const statLabel = supportedStatLabels.find((label) => cardText.toLowerCase().includes(label.toLowerCase()));
      if (!statLabel) continue;
      const higherButtons = [...card.querySelectorAll('button, [role="button"]')]
        .filter((button) => /^Higher(?:\s*\d+(?:\.\d+)?x)?$/i.test(text(button)));
      const lowerButtons = [...card.querySelectorAll('button, [role="button"]')]
        .filter((button) => /^Lower(?:\s*\d+(?:\.\d+)?x)?$/i.test(text(button)));
      if (higherButtons.length !== 1 || lowerButtons.length !== 1) continue;
      const higherButton = higherButtons[0];
      const lowerButton = lowerButtons[0];
      const lineMatch = cardText.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${escapePattern(statLabel)}`, "i"));
      const lines = (card.innerText || "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
      const matchupIndex = lines.findIndex((line) => /(?:\s@\s|\svs\s).*\b\d{1,2}\/\d{1,2}\b/i.test(line));
      const playerName = matchupIndex > 0 ? lines[matchupIndex - 1] : "";
      const isNonStandard = /\b(?:boost|boosted|special|discount|demon|goblin|scorcher|rescue|promotion)\b/i.test(cardText);
      if (!playerName || !lineMatch) continue;
      const higherMultiplier = modifier(higherButton);
      const lowerMultiplier = modifier(lowerButton);
      const row = {
        playerName,
        statLabel,
        line: Number(lineMatch[1]),
        ...(Number.isFinite(higherMultiplier) && Number.isFinite(lowerMultiplier) ? { higherMultiplier, lowerMultiplier } : {}),
        marketScope: "week_1",
        sourceUrl: location.href,
        isNonStandard,
      };
      rowsByKey.set(`${statLabel}:${playerName.toLowerCase()}`, row);
      statLabels.add(statLabel);
    }
  };

  for (let attempt = 0; attempt < 120 && !supportedTabs.some(({ tab }) => findExactButton(tab)); attempt += 1) {
    await sleep(150);
  }

  for (const { tab, statLabels: tabStatLabels } of supportedTabs) {
    const button = findExactButton(tab);
    if (!button) throw new Error(`Underdog ${tab} tab is missing`);
    button.scrollIntoView({ block: "nearest", inline: "center" });
    button.click();
    for (let attempt = 0; attempt < 100 && !tabStatLabels.some((label) => document.body.innerText.includes(label)); attempt += 1) {
      await sleep(150);
    }
    window.scrollTo(0, 0);
    await sleep(250);
    let stableChecks = 0;
    let priorSize = -1;
    let priorHeight = -1;
    for (let attempt = 0; attempt < 160 && stableChecks < 6; attempt += 1) {
      readVisibleCards(tabStatLabels);
      const height = document.documentElement.scrollHeight;
      const atBottom = window.scrollY + window.innerHeight >= height - 12;
      stableChecks = atBottom && rowsByKey.size === priorSize && height === priorHeight ? stableChecks + 1 : 0;
      priorSize = rowsByKey.size;
      priorHeight = height;
      window.scrollBy(0, Math.max(window.innerHeight * 0.8, 600));
      await sleep(100);
    }
    readVisibleCards(tabStatLabels);
  }
  window.scrollTo(0, 0);
  return {
    rows: [...rowsByKey.values()],
    marketCount: rowsByKey.size,
    statLabels: [...statLabels],
    unavailable: /not available in your location|location.*required/i.test(document.body.innerText),
  };
}

async function scrapeSleeperAdpPage() {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const expected = {
    teams: 12,
    rounds: 13,
    receptionPpr: 1,
    passingTdPoints: 4,
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, BENCH: 5, K: 0, DEF: 0 },
  };
  const pageText = document.body.innerText.replace(/\s+/g, " ");
  if (!/Redraft league PPR 4pt passing/i.test(pageText) || !/12 Teams/i.test(pageText) || !/13 Rounds/i.test(pageText)) {
    throw new Error("Sleeper board must be the 12-team full-PPR, 4-point passing-TD, 13-round board");
  }

  const grid = document.querySelector('[role="grid"]');
  if (!grid) throw new Error("Sleeper player ADP grid is missing");
  const scrollHost = grid.closest(".scrollbar-container") || grid;
  const rowsByKey = new Map();
  const readRows = () => [...document.querySelectorAll(".player-rank-item2")].map((row) => {
    const nameWrapper = row.querySelector(".name-wrapper");
    const name = [...(nameWrapper?.childNodes || [])]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const position = ["QB", "RB", "WR", "TE"].find((item) => row.classList.contains(item)) || "";
    const value = (selector) => row.querySelector(selector)?.textContent?.trim() || "";
    return {
      rank: Number(value(".rank")),
      name,
      team: value(".team"),
      position,
      adp: Number(value(".adp .value")),
      bye: Number(value(".bye .value")),
      sleeperPoints: Number(value(".proj-pts .value")),
    };
  }).filter((row) => row.name && row.position && Number.isFinite(row.adp) && row.adp > 0);

  for (let step = 0; step < 50 && rowsByKey.size < 250; step += 1) {
    for (const row of readRows()) rowsByKey.set(`${row.position}:${row.name.toLowerCase()}`, row);
    scrollHost.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY: 560,
      view: window,
    }));
    await sleep(120);
  }
  for (const row of readRows()) rowsByKey.set(`${row.position}:${row.name.toLowerCase()}`, row);
  const rows = [...rowsByKey.values()].sort((left, right) => left.adp - right.adp || left.rank - right.rank).slice(0, 250);
  if (rows.length < 150) throw new Error(`Sleeper ADP captured only ${rows.length} of at least 150 required players`);
  return { rows, marketCount: rows.length, format: expected, unavailable: false };
}

async function scrapeTab(tabId, scraper) {
  const functions = {
    draftkings: scrapeDraftKingsPage,
    fanduel: scrapeFanDuelPage,
    prizepicks: scrapePrizePicksPage,
    underdog: scrapeUnderdogPage,
    sleeper: scrapeSleeperAdpPage,
  };
  let lastResult;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    await waitForScraperPage(tabId, scraper);
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: functions[scraper] });
    const result = results[0]?.result;
    lastResult = result;
    if (result?.unavailable) throw new Error(result.unavailableReason || "Source lines are unavailable in this browser session");
    if (result?.rows?.length) return result;
  }
  if (lastResult?.expectedMarketCount) {
    throw new Error(`Captured ${lastResult.marketCount || 0} of ${lastResult.expectedMarketCount} discovered season markets`);
  }
  if (scraper === "sleeper") throw new Error("No Sleeper ADP player rows appeared after a retry");
  if (scraper === "underdog") throw new Error("No Week 1 TD or reception rows appeared after a retry");
  throw new Error("No season prop rows appeared after a retry");
}

async function collectPage(source, spec) {
  const tab = await chrome.tabs.create({ url: spec.url, active: ["fanduel", "prizepicks", "underdog", "sleeper"].includes(source.id) });
  try {
    await waitForTab(tab.id);
    const result = await scrapeTab(tab.id, source.scraper);
    return { ...spec, capturedAt: new Date().toISOString(), ...result };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function extractSeason(pages) {
  const matches = JSON.stringify(pages).match(/\b(20\d{2})[/-]\d{2}\b/g) || [];
  const seasons = new Set(matches.map((match) => Number(match.slice(0, 4))));
  if (seasons.size !== 1) throw new Error("Could not identify one season from the sportsbook pages");
  return [...seasons][0];
}

async function collectPass(source) {
  const pages = [];
  for (const market of source.pages) pages.push(await collectPage(source, market));
  const capturedStatLabels = new Set(pages.flatMap((page) => page.statLabels || []));
  const missingStatLabels = (source.requiredStatLabels || []).filter((label) => !capturedStatLabels.has(label));
  if (missingStatLabels.length) throw new Error(`Required market categories are missing: ${missingStatLabels.join(", ")}`);
  return {
    source: source.id,
    season: typeof source.season === "function" ? source.season() : extractSeason(pages),
    capturedAt: new Date().toISOString(),
    marketCount: pages.reduce((total, page) => total + page.marketCount, 0),
    ...(source.id === "sleeper" ? { format: pages[0].format } : {}),
    pages,
  };
}

async function saveCapture(capture, pass) {
  const response = await fetch("http://127.0.0.1:4173/api/capture", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-NFL-Prop-Collector": "1",
    },
    body: JSON.stringify({ pass, capture }),
  });
  if (!response.ok) throw new Error(`Local capture save failed (${response.status}): ${await response.text()}`);
  return response.json();
}

let activeRun = false;

function currentLedgerDate(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function initializeExtension() {
  await disableLegacyAutomaticCapture();
  const state = await chrome.storage.local.get(["running", "runningSince"]);
  if (!state.running) return;
  await chrome.storage.local.set({
    running: false,
    runningSince: null,
    lastStatus: "The previous capture was interrupted. Ready to retry.",
    lastError: "",
  });
}

const initialized = initializeExtension();

async function getStatus() {
  await initialized;
  const state = await chrome.storage.local.get(["running", "runningSince", "lastStatus", "lastError", "lastSuccess", "progressPercent", "progressSource", "progressDetail"]);
  if (!activeRun && isRunLeaseActive(state)) {
    await chrome.storage.local.set({ running: false, runningSince: null });
    return { ...state, running: false, runningSince: null };
  }
  return state;
}

async function runCapture() {
  await initialized;
  if (activeRun) throw new Error("A capture is already running");
  activeRun = true;
  const retryState = await chrome.storage.local.get(["lastFailedSourceIds", "lastRunLedgerDate", "lastError", "lastSuccess"]);
  const storedFailedSourceIds = Array.isArray(retryState.lastFailedSourceIds) ? retryState.lastFailedSourceIds : [];
  const inferredFailedSourceIds = SOURCES.filter((source) => String(retryState.lastError || "").includes(`${source.name}:`)).map((source) => source.id);
  const failedSourceIds = storedFailedSourceIds.length ? storedFailedSourceIds : inferredFailedSourceIds;
  const previousRunDate = retryState.lastRunLedgerDate || (retryState.lastSuccess ? currentLedgerDate(new Date(retryState.lastSuccess)) : "");
  const retryingToday = previousRunDate === currentLedgerDate() && failedSourceIds.length > 0;
  const runSources = retryingToday ? SOURCES.filter((source) => failedSourceIds.includes(source.id)) : SOURCES;
  await chrome.storage.local.set({ running: true, runningSince: Date.now(), lastStatus: retryingToday ? "Retrying rejected sources…" : "Starting multi-book capture…", lastError: "", progressPercent: 0, progressSource: retryingToday ? "Preparing retry" : "Preparing sources", progressDetail: `0 of ${runSources.length} complete` });
  try {
    const successes = [];
    const failures = [];
    const rejectedSourceIds = [];
    let completedSourceCount = 0;
    const captureSource = async (source) => {
      let sourceError;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const retryLabel = attempt === 1 ? "" : " (retry)";
          const startingPercent = Math.round((completedSourceCount / runSources.length) * 100);
          await chrome.storage.local.set({
            lastStatus: `Capturing and validating ${source.name}${retryLabel}…`,
            progressPercent: startingPercent,
            progressSource: `${source.name}${retryLabel}`,
            progressDetail: `${completedSourceCount} of ${runSources.length} sources complete`,
          });
          const capture = await collectPass(source);
          const verifiedCapture = { ...capture, verificationMode: "validated-single-pass" };
          // Keep the established primary/confirmation intake contract while avoiding a
          // second full browser scrape. collectPass already rejects incomplete sources;
          // the outer attempt loop performs a fresh scrape only after a rejection.
          await saveCapture(verifiedCapture, "primary");
          await saveCapture(verifiedCapture, "confirmation");
          successes.push(`${source.name} ${verifiedCapture.marketCount}`);
          sourceError = null;
          break;
        } catch (error) {
          sourceError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 10_000));
        }
      }
      if (sourceError) {
        failures.push(`${source.name}: ${sourceError.message}`);
        rejectedSourceIds.push(source.id);
      }
      completedSourceCount += 1;
      await chrome.storage.local.set({
        progressPercent: Math.round((completedSourceCount / runSources.length) * 100),
        progressSource: sourceError ? `${source.name} skipped` : `${source.name} complete`,
        progressDetail: `${completedSourceCount} of ${runSources.length} sources checked`,
      });
    };
    const backgroundSources = runSources.filter((source) => source.id === "draftkings");
    const interactiveSources = runSources.filter((source) => source.id !== "draftkings");
    await Promise.all([
      (async () => {
        for (const source of backgroundSources) await captureSource(source);
      })(),
      (async () => {
        for (const source of interactiveSources) await captureSource(source);
      })(),
    ]);
    if (successes.length === 0) throw new Error(failures.join("; "));
    const lastStatus = `Captured and validated ${successes.join(", ")}${failures.length ? `; ${failures.length} source rejected` : ""}`;
    await chrome.storage.local.set({
      lastStatus,
      lastSuccess: new Date().toISOString(),
      lastError: failures.join("\n"),
      lastFailedSourceIds: rejectedSourceIds,
      lastRunLedgerDate: currentLedgerDate(),
      progressPercent: 100,
      progressSource: "Capture complete",
      progressDetail: `${runSources.length} of ${runSources.length} sources checked`,
    });
  } catch (error) {
    await chrome.storage.local.set({ lastStatus: "Capture rejected", lastError: error.message });
    throw error;
  } finally {
    activeRun = false;
    await chrome.storage.local.set({ running: false, runningSince: null });
  }
}

chrome.runtime.onInstalled.addListener(disableLegacyAutomaticCapture);
chrome.runtime.onStartup.addListener(disableLegacyAutomaticCapture);
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "get-status") {
    getStatus().then(sendResponse).catch((error) => sendResponse({ lastStatus: "Status unavailable", lastError: error.message }));
    return true;
  }
  if (message?.type === "capture-now") {
    runCapture().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
