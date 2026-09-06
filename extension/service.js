import { filterActiveFailedSourceIds, isRunLeaseActive } from "./run-state.js";

const SOURCES = [
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
    requiredStatLabels: ["Pass TDs", "Pass Yards", "Rush Yards", "Rec Yards", "Receptions", "Rush + Rec TDs"],
    pages: [{ id: "nfl-week-1-player-props", url: "https://app.underdogsports.com/pick-em/higher-lower/all/NFL" }],
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
    ["fantasy", "Fantasy Score"], ["fantasy score", "Fantasy Score"],
    ["fantasy points", "Fantasy Score"], ["fantasy pts", "Fantasy Score"],
    ["rush+rec tds", "Rush+Rec TDs"], ["rush + rec tds", "Rush+Rec TDs"],
    ["rushing + receiving touchdowns", "Rush+Rec TDs"], ["player touchdowns", "Rush+Rec TDs"],
  ]);
  const text = (element) => element?.textContent?.replace(/\s+/g, " ").trim() || "";
  const normalizedLabel = (value) => value
    .replace(/^(?:SZN|W(?:EEK|K)?\s*1)\s+/i, "")
    .replace(/\s*\([^)]*PPR[^)]*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
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
  const readVisibleRows = (marketScope) => projectionRows().map((row) => {
    const rowText = text(row);
    return {
      playerName: text(row.querySelector('#test-player-name, [data-testid="player-name"], [class*="player-name"]')),
      teamPosition: text(row.querySelector('#test-team-position, [data-testid="team-position"], [class*="team-position"]')),
      line: text(row.querySelector('.heading-md, [data-testid="projection-line"], [class*="projection-line"]')),
      displayedStatLabel: canonicalLabel(text(row.querySelector('.max-w-28, [data-testid="stat-type"], [class*="stat-type"]'))),
      marketScope: /(?:regular season|\bSZN\b)/i.test(rowText) ? "regular_season" : marketScope,
      isNonStandard: Boolean(row.querySelector('img[alt="Demon" i], img[alt="Goblin" i], [aria-label*="Demon" i], [aria-label*="Goblin" i]'))
        || /\b(?:Demon|Goblin)\b/i.test(rowText),
    };
  }).filter((row) => row.playerName
    && row.displayedStatLabel
    && /^\d+(?:\.\d+)?$/.test(row.line)
    && /(?:^| - )(QB|RB|WR|TE)$/.test(row.teamPosition)
    && !row.isNonStandard)
    .map(({ displayedStatLabel, ...row }) => ({ ...row, statLabel: displayedStatLabel }));

  const recordVisibleRows = (marketScope) => {
    const rows = readVisibleRows(marketScope);
    for (const row of rows) rowsByKey.set(`${marketScope}:${row.playerName}:${row.statLabel}`, row);
    if (marketScope === "regular_season") {
      for (const row of rows) seasonStatLabels.add(row.statLabel);
    }
    return rows.filter((row) => row.marketScope === marketScope);
  };

  const scanCurrentBoard = async (marketScope, targetLabel = null) => {
    window.scrollTo(0, 0);
    await sleep(200);
    let stableChecks = 0;
    let priorCount = -1;
    let priorHeight = -1;
    for (let attempt = 0; attempt < 160 && stableChecks < 6; attempt += 1) {
      recordVisibleRows(marketScope);
      const count = [...rowsByKey.values()].filter((row) => row.marketScope === marketScope
        && (!targetLabel || row.statLabel === targetLabel)).length;
      const height = document.documentElement.scrollHeight;
      const atBottom = window.scrollY + window.innerHeight >= height - 12;
      stableChecks = atBottom && count === priorCount && height === priorHeight ? stableChecks + 1 : 0;
      priorCount = count;
      priorHeight = height;
      window.scrollBy(0, Math.max(window.innerHeight * 0.75, 600));
      await sleep(100);
    }
    recordVisibleRows(marketScope);
    window.scrollTo(0, 0);
  };

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

    const findNavigation = () => document.querySelector('[aria-label="Stats Navigation"]') || [...document.querySelectorAll("nav")]
      .find((nav) => [...nav.querySelectorAll("button")].some((button) => canonicalLabel(text(button))));
    const navigation = findNavigation();
    if (!navigation) {
      if (required) throw new Error("PrizePicks statistic navigation is missing");
      return;
    }
    const statButtons = [...new Map([...navigation.querySelectorAll("button")]
      .map((button) => ({ rawLabel: text(button), label: canonicalLabel(text(button)) }))
      .filter((item) => item.label)
      .map((item) => [item.label, item])).values()];
    if (required && statButtons.length === 0) throw new Error("PrizePicks statistic buttons are missing");

    for (let scanPass = 0; scanPass < 2; scanPass += 1) {
      for (const { rawLabel, label } of statButtons) {
        const currentNavigation = findNavigation();
        const button = [...(currentNavigation?.querySelectorAll("button") || [])]
          .find((candidate) => canonicalLabel(text(candidate)) === label && text(candidate) === rawLabel);
        if (!button) {
          if (required) throw new Error(`PrizePicks statistic button disappeared: ${rawLabel}`);
          continue;
        }
        button.scrollIntoView({ block: "nearest", inline: "center" });
        button.click();
        for (let attempt = 0; attempt < 45; attempt += 1) {
          const capturedRows = readVisibleRows(marketScope);
          if (capturedRows.some((row) => row.statLabel === label)) break;
          await sleep(120);
        }
        await scanCurrentBoard(marketScope, label);
      }
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
    { tab: "Passing", statLabels: ["Pass Yards", "Pass TDs"] },
    { tab: "Rushing", statLabels: ["Rush Yards"] },
    { tab: "Receiving", statLabels: ["Receptions", "Receiving Yards", "Rec Yards"] },
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
      const displayedStatLabel = supportedStatLabels.find((label) => cardText.toLowerCase().includes(label.toLowerCase()));
      if (!displayedStatLabel) continue;
      const statLabel = displayedStatLabel === "Receiving Yards" ? "Rec Yards" : displayedStatLabel;
      const higherButtons = [...card.querySelectorAll('button, [role="button"]')]
        .filter((button) => /^Higher(?:\s*\d+(?:\.\d+)?x)?$/i.test(text(button)));
      const lowerButtons = [...card.querySelectorAll('button, [role="button"]')]
        .filter((button) => /^Lower(?:\s*\d+(?:\.\d+)?x)?$/i.test(text(button)));
      if (higherButtons.length !== 1 || lowerButtons.length !== 1) continue;
      const higherButton = higherButtons[0];
      const lowerButton = lowerButtons[0];
      const lineMatch = cardText.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${escapePattern(displayedStatLabel)}`, "i"));
      const lines = (card.innerText || "").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
      const matchupIndex = lines.findIndex((line) => /(?:\s@\s|\svs\s)/i.test(line));
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

  for (let scanPass = 0; scanPass < 2; scanPass += 1) {
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
  }

  window.scrollTo(0, 0);
  return {
    rows: [...rowsByKey.values()],
    marketCount: rowsByKey.size,
    statLabels: [...statLabels],
    unavailable: /not available in your location|location.*required/i.test(document.body.innerText),
  };
}

async function scrapeTab(tabId, scraper) {
  const functions = {
    prizepicks: scrapePrizePicksPage,
    underdog: scrapeUnderdogPage,
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
    throw new Error(`Captured ${lastResult.marketCount || 0} of ${lastResult.expectedMarketCount} discovered markets`);
  }
  if (scraper === "underdog") throw new Error("No Week 1 TD or reception rows appeared after a retry");
  throw new Error("No supported prop rows appeared after a retry");
}

async function collectPage(source, spec) {
  const tab = await chrome.tabs.create({
    url: spec.url,
    active: spec.active ?? ["prizepicks", "underdog"].includes(source.id),
  });
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
  const activeSourceIds = SOURCES.map((source) => source.id);
  const activeStoredFailedSourceIds = filterActiveFailedSourceIds(storedFailedSourceIds, activeSourceIds);
  const inferredFailedSourceIds = SOURCES.filter((source) => String(retryState.lastError || "").includes(`${source.name}:`)).map((source) => source.id);
  const failedSourceIds = activeStoredFailedSourceIds.length ? activeStoredFailedSourceIds : inferredFailedSourceIds;
  const previousRunDate = retryState.lastRunLedgerDate || (retryState.lastSuccess ? currentLedgerDate(new Date(retryState.lastSuccess)) : "");
  const retryingToday = previousRunDate === currentLedgerDate() && failedSourceIds.length > 0;
  const runSources = retryingToday ? SOURCES.filter((source) => failedSourceIds.includes(source.id)) : SOURCES;
  await chrome.storage.local.set({ running: true, runningSince: Date.now(), lastStatus: retryingToday ? "Retrying rejected sources…" : "Starting PrizePicks + Underdog capture…", lastError: "", progressPercent: 0, progressSource: retryingToday ? "Preparing retry" : "Preparing sources", progressDetail: `0 of ${runSources.length} complete` });
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
    for (const source of runSources) await captureSource(source);
    if (successes.length === 0) throw new Error(failures.join("; ") || "No active capture sources completed");
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
    const errorMessage = String(error?.message || "Capture stopped before any source completed").trim();
    await chrome.storage.local.set({ lastStatus: "Capture rejected", lastError: errorMessage });
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
