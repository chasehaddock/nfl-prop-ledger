export const FANDUEL_WEEKLY_MARKET_TABS = [
  "passing-props",
  "rushing-props",
  "receiving-props",
];

export function normalizeFanDuelEventUrls(hrefs, { maxEvents = 16 } = {}) {
  const eventUrls = new Map();
  for (const href of hrefs) {
    let url;
    try {
      url = new URL(href, "https://sportsbook.fanduel.com");
    } catch {
      continue;
    }
    if (url.origin !== "https://sportsbook.fanduel.com") continue;
    if (!/^\/football\/nfl\/[^/?#]+-\d+\/?$/i.test(url.pathname)) continue;
    const baseUrl = `${url.origin}${url.pathname.replace(/\/$/, "")}`;
    if (!eventUrls.has(baseUrl)) eventUrls.set(baseUrl, baseUrl);
    if (eventUrls.size >= maxEvents) break;
  }
  return [...eventUrls.values()];
}

export function buildFanDuelWeeklyMarketPages(eventUrls) {
  return eventUrls.flatMap((eventUrl, eventIndex) => FANDUEL_WEEKLY_MARKET_TABS.map((tab) => ({
    id: `week-1-event-${eventIndex + 1}-${tab}`,
    url: `${eventUrl}?tab=${tab}`,
    active: false,
    optional: true,
  })));
}
