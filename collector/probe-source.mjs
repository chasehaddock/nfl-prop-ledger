import { chromium } from "playwright";

const [source, targetUrl, clickText] = process.argv.slice(2);

if (!source || !targetUrl) {
  console.error("Usage: node collector/probe-source.mjs <source> <url>");
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  locale: "en-US",
  timezoneId: "America/Denver",
  geolocation: { latitude: 39.7392, longitude: -104.9903 },
  permissions: ["geolocation"],
  serviceWorkers: "block",
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const responses = [];

page.on("response", async (response) => {
  const contentType = response.headers()["content-type"] ?? "";
  const interestingUrl = /api|event|market|offer|projection|coupon/i.test(response.url());
  if (!contentType.includes("json") && !interestingUrl) return;

  try {
    const body = await response.body();
    if (body.length < 100) return;
    const parsed = contentType.includes("json") ? JSON.parse(body.toString("utf8")) : null;
    responses.push({
      url: response.url(),
      status: response.status(),
      bytes: body.length,
      contentType,
      keys: parsed === null ? [] : Array.isArray(parsed) ? [`array:${parsed.length}`] : Object.keys(parsed).slice(0, 16),
    });
  } catch {
    // A probe should keep going when a response is unavailable or not valid JSON.
  }
});

try {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(10_000);
  if (clickText) {
    const target = page.getByText(clickText, { exact: true }).first();
    if (await target.isVisible()) {
      await target.click();
      await page.waitForTimeout(8_000);
    }
  }
  const title = await page.title();
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 5_000);
  const links = await page.locator("a").evaluateAll((anchors) => anchors
    .map((anchor) => ({ text: anchor.textContent?.trim().replace(/\s+/g, " ") ?? "", href: anchor.href }))
    .filter((anchor) => /future|season|player|passing|rushing|receiving|reception|touchdown/i.test(`${anchor.text} ${anchor.href}`))
    .slice(0, 100));
  console.log(JSON.stringify({ source, finalUrl: page.url(), title, text, links, responses }, null, 2));
} finally {
  await browser.close();
}
