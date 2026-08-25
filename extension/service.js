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
    id: "betmgm",
    name: "BetMGM",
    scraper: "betmgm",
    pages: [{ id: "regular-season-stats", url: "https://www.az.betmgm.com/en/sports/events/2026-27-nfl-regular-season-stats-19070789" }],
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
    id: "sleeper",
    name: "Sleeper ADP",
    scraper: "sleeper",
    season: () => new Date().getFullYear(),
    pages: [{ id: "redraft-adp", url: SLEEPER_DRAFT_URL }],
  },
];

function nextCaptureTime() {
  const next = new Date();
  next.setHours(8, 17, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get("daily-capture");
  if (!alarm) chrome.alarms.create("daily-capture", { when: nextCaptureTime(), periodInMinutes: 24 * 60 });
}

async function waitForTab(tabId) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Sportsbook page did not finish loading");
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
  const cardPattern = /^.+ Regular Season (Passing Yards|Passing TDs|Rushing Yards|Rushing TDs|Receiving Yards|Receiving TDs|Receptions) 20\d{2}-\d{2}$/i;
  const outcomePattern = / Regular Season (Passing Yards|Passing TDs|Rushing Yards|Rushing TDs|Receiving Yards|Receiving TDs|Receptions) 20\d{2}-\d{2}, .+ (Over|Under) \d/i;
  const discoverMarketLabels = () => new Set(
    [...document.querySelectorAll('[role="button"], h3')]
      .map((element) => element.getAttribute("aria-label")?.split(",")[0]?.trim() || element.textContent.trim())
      .filter((label) => cardPattern.test(label)),
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
  const readOutcomes = (marketLabel) => [...document.querySelectorAll('[role="button"][aria-label]')]
    .map((element) => element.getAttribute("aria-label")?.trim() || "")
    .filter((label) => label.startsWith(`${marketLabel}, `) && outcomePattern.test(label));

  for (const marketLabel of marketLabels) {
    let outcomes = readOutcomes(marketLabel);
    if (outcomes.length !== 2) {
      const card = [...document.querySelectorAll('[role="button"]:not([aria-label])')]
        .find((element) => element.textContent.trim() === marketLabel);
      if (!card) {
        return { rows: [], marketCount: outcomesByMarket.size, expectedMarketCount: marketLabels.size, unavailable: false };
      }
      card.click();
      for (let attempt = 0; attempt < 20 && outcomes.length !== 2; attempt += 1) {
        await sleep(50);
        outcomes = readOutcomes(marketLabel);
      }
    }
    if (outcomes.length !== 2) {
      return { rows: [], marketCount: outcomesByMarket.size, expectedMarketCount: marketLabels.size, unavailable: false };
    }
    outcomesByMarket.set(marketLabel, outcomes);
  }

  const labels = [...outcomesByMarket.values()].flat();
  const statLabels = [...new Set([...marketLabels].map((label) => label.match(cardPattern)?.[1]).filter(Boolean))];
  return {
    rows: labels.map((ariaLabel) => ({ ariaLabel })),
    marketCount: outcomesByMarket.size,
    expectedMarketCount: marketLabels.size,
    statLabels,
    unavailable: /unable to display|not available in your location/i.test(document.body.innerText),
  };
}

function discoverFanDuelWeekOneGames() {
  const links = [...document.querySelectorAll('main a[href*="/football/nfl/"]')]
    .map((anchor) => {
      try {
        return new URL(anchor.getAttribute("href"), location.origin);
      } catch {
        return null;
      }
    })
    .filter((url) => url
      && url.hostname === "sportsbook.fanduel.com"
      && /^\/football\/nfl\/[^/]+-\d+$/.test(url.pathname));
  return [...new Set(links.map((url) => `${url.origin}${url.pathname}`))];
}

async function scrapeFanDuelWeekOnePassingTouchdowns() {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const labelPattern = /^(.+?) - Passing TDs, (.+?) (Over|Under), (\d+(?:\.\d+)?), ([+−–—-]?\d+)$/i;
  const marketPattern = /^.+ - Passing TDs$/i;
  const readRows = () => [...document.querySelectorAll('[role="button"][aria-label]')]
    .map((element) => element.getAttribute("aria-label")?.trim() || "")
    .filter((label) => {
      const match = label.match(labelPattern);
      return match && match[1].trim().toLowerCase() === match[2].trim().toLowerCase();
    });

  const marketLabels = [...new Set([...document.querySelectorAll('[role="button"][aria-label]')]
    .map((element) => element.getAttribute("aria-label")?.trim() || "")
    .filter((label) => marketPattern.test(label)))];
  for (const marketLabel of marketLabels) {
    let outcomes = readRows().filter((label) => label.startsWith(`${marketLabel}, `));
    if (outcomes.length === 2) continue;
    const header = [...document.querySelectorAll('[role="button"][aria-label]')]
      .find((element) => element.getAttribute("aria-label")?.trim() === marketLabel);
    if (!header) continue;
    header.click();
    for (let attempt = 0; attempt < 20 && outcomes.length !== 2; attempt += 1) {
      await sleep(75);
      outcomes = readRows().filter((label) => label.startsWith(`${marketLabel}, `));
    }
  }

  let labels = [];
  for (let attempt = 0; attempt < 40 && labels.length === 0; attempt += 1) {
    labels = readRows();
    if (!labels.length) await sleep(150);
  }
  const groups = new Map();
  for (const ariaLabel of labels) {
    const match = ariaLabel.match(labelPattern);
    const key = match[1].trim().toLowerCase();
    groups.set(key, [...(groups.get(key) || []), ariaLabel]);
  }
  const complete = [...groups.values()].filter((outcomes) => outcomes.length === 2);
  return {
    rows: complete.flat().map((ariaLabel) => ({
      ariaLabel,
      marketScope: "week_1",
      sourceUrl: location.href,
    })),
    marketCount: complete.length,
  };
}

async function collectFanDuelWeekOnePassingTouchdowns() {
  const navigationUrl = "https://sportsbook.fanduel.com/navigation/nfl?tab=week-1";
  const navigationTab = await chrome.tabs.create({ url: navigationUrl, active: true });
  let gameUrls = [];
  try {
    await waitForTab(navigationTab.id);
    for (let attempt = 0; attempt < 2 && gameUrls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 3000 : 5000));
      const results = await chrome.scripting.executeScript({ target: { tabId: navigationTab.id }, func: discoverFanDuelWeekOneGames });
      gameUrls = results[0]?.result || [];
    }
  } finally {
    await chrome.tabs.remove(navigationTab.id).catch(() => {});
  }
  if (!gameUrls.length) throw new Error("FanDuel Week 1 game links are unavailable");

  const rows = [];
  let marketCount = 0;
  for (const gameUrl of gameUrls) {
    const eventUrl = `${gameUrl}?tab=passing-props`;
    const eventTab = await chrome.tabs.create({ url: eventUrl, active: true });
    try {
      await waitForTab(eventTab.id);
      let result = { rows: [], marketCount: 0 };
      for (let attempt = 0; attempt < 2 && result.rows.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1800 : 3000));
        const results = await chrome.scripting.executeScript({ target: { tabId: eventTab.id }, func: scrapeFanDuelWeekOnePassingTouchdowns });
        result = results[0]?.result || result;
      }
      rows.push(...result.rows);
      marketCount += result.marketCount;
    } finally {
      await chrome.tabs.remove(eventTab.id).catch(() => {});
    }
  }
  if (!rows.length) throw new Error("FanDuel Week 1 Passing TD markets are unavailable");
  return { rows, marketCount, eventCount: gameUrls.length };
}

async function scrapeBetMgmPage() {
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const panels = [
    { panel: "Regular season passing stats", tabs: ["Passing yards O/U", "Passing TDs"] },
    { panel: "Regular season rushing stats", tabs: ["Rushing yards O/U", "Rushing TDs"] },
    { panel: "Regular season receiving stats", tabs: ["Receiving yards O/U", "Receiving TDs"] },
  ];
  const rows = [];

  for (const spec of panels) {
    const panel = [...document.querySelectorAll("ms-option-panel")].find((candidate) =>
      candidate.querySelector(".ds-accordion-header-clickable-area")?.textContent?.trim() === spec.panel);
    if (!panel) throw new Error(`BetMGM panel is missing: ${spec.panel}`);
    const header = panel.querySelector(".ds-accordion-header-clickable-area");
    if (header.getAttribute("aria-expanded") !== "true") {
      header.click();
      await sleep(550);
    }

    for (const statLabel of spec.tabs) {
      const tab = [...panel.querySelectorAll('[role="tab"]')].find((candidate) => candidate.textContent.trim() === statLabel);
      if (!tab) throw new Error(`BetMGM stat tab is missing: ${statLabel}`);
      tab.click();
      await sleep(550);
      const showMore = [...panel.querySelectorAll(".show-more-less-button")]
        .find((candidate) => candidate.textContent.trim() === "Show More");
      if (showMore) {
        showMore.click();
        await sleep(550);
      }

      const statRows = [...panel.querySelectorAll(".option-group-row.flex-column")].map((row) => ({
        statLabel,
        playerName: row.querySelector(".player-props-player-name")?.textContent?.trim() || "",
        outcomes: [...row.querySelectorAll("ms-option")].map((option) => ({
          title: option.querySelector(".name")?.textContent?.trim() || "",
          odds: option.querySelector(".option-value")?.textContent?.trim() || "",
          optionId: option.querySelector("[data-test-option-id]")?.getAttribute("data-test-option-id") || "",
        })),
      }));
      if (statRows.length === 0) throw new Error(`BetMGM stat has no rows: ${statLabel}`);
      rows.push(...statRows);
    }
  }
  return { rows, marketCount: rows.length, unavailable: /Where are you playing from\?/i.test(document.body.innerText) };
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
    betmgm: scrapeBetMgmPage,
    prizepicks: scrapePrizePicksPage,
    sleeper: scrapeSleeperAdpPage,
  };
  let lastResult;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 3000 : 5000));
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: functions[scraper] });
    const result = results[0]?.result;
    lastResult = result;
    if (result?.unavailable) throw new Error(result.unavailableReason || "Source lines are unavailable in this browser session");
    if (result?.rows?.length) return result;
  }
  if (lastResult?.expectedMarketCount) {
    throw new Error(`Captured ${lastResult.marketCount || 0} of ${lastResult.expectedMarketCount} discovered season markets`);
  }
  throw new Error(scraper === "sleeper" ? "No Sleeper ADP player rows appeared after a retry" : "No season prop rows appeared after a retry");
}

async function collectPage(source, spec) {
  const tab = await chrome.tabs.create({ url: spec.url, active: ["fanduel", "prizepicks", "sleeper"].includes(source.id) });
  try {
    await waitForTab(tab.id);
    const result = await scrapeTab(tab.id, source.scraper);
    if (source.id !== "fanduel") return { ...spec, capturedAt: new Date().toISOString(), ...result };
    const weeklyPassingTouchdowns = await collectFanDuelWeekOnePassingTouchdowns();
    return {
      ...spec,
      capturedAt: new Date().toISOString(),
      ...result,
      rows: [...result.rows, ...weeklyPassingTouchdowns.rows],
      marketCount: result.marketCount + weeklyPassingTouchdowns.marketCount,
      weekOneEventCount: weeklyPassingTouchdowns.eventCount,
      weekOnePassingTouchdownMarketCount: weeklyPassingTouchdowns.marketCount,
    };
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

async function initializeExtension() {
  await ensureAlarm();
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
  const state = await chrome.storage.local.get(["running", "runningSince", "lastStatus", "lastError", "lastSuccess"]);
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
  await chrome.storage.local.set({ running: true, runningSince: Date.now(), lastStatus: "Starting multi-book capture…", lastError: "" });
  try {
    const successes = [];
    const failures = [];
    for (const source of SOURCES) {
      let sourceError;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const retryLabel = attempt === 1 ? "" : " (retry)";
          await chrome.storage.local.set({ lastStatus: `Capturing ${source.name} primary pass${retryLabel}…` });
          const primary = await collectPass(source);
          await chrome.storage.local.set({ lastStatus: `Confirming every ${source.name} line${retryLabel}…` });
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const confirmation = await collectPass(source);
          if (primary.marketCount !== confirmation.marketCount) {
            throw new Error(`Primary captured ${primary.marketCount} markets but confirmation captured ${confirmation.marketCount}`);
          }
          await saveCapture(primary, "primary");
          await saveCapture(confirmation, "confirmation");
          successes.push(`${source.name} ${confirmation.marketCount}`);
          sourceError = null;
          break;
        } catch (error) {
          sourceError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 10_000));
        }
      }
      if (sourceError) failures.push(`${source.name}: ${sourceError.message}`);
    }
    if (successes.length === 0) throw new Error(failures.join("; "));
    const lastStatus = `Captured ${successes.join(", ")} twice${failures.length ? `; ${failures.length} source rejected` : ""}`;
    await chrome.storage.local.set({
      lastStatus,
      lastSuccess: new Date().toISOString(),
      lastError: failures.join("\n"),
    });
  } catch (error) {
    await chrome.storage.local.set({ lastStatus: "Capture rejected", lastError: error.message });
    throw error;
  } finally {
    activeRun = false;
    await chrome.storage.local.set({ running: false, runningSince: null });
  }
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "daily-capture") runCapture().catch(() => {}); });
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
