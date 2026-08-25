import path from "node:path";
import { chromium } from "playwright";
import { DRAFTKINGS_MARKETS } from "./draftkings-config.mjs";

const profileDir = path.resolve(".private/chrome-profile");
const context = await chromium.launchPersistentContext(profileDir, {
  channel: "chrome",
  headless: false,
  locale: "en-US",
  timezoneId: "America/Denver",
  geolocation: { latitude: 39.7392, longitude: -104.9903 },
  permissions: ["geolocation"],
});
const page = context.pages()[0] || await context.newPage();
await page.goto(DRAFTKINGS_MARKETS[0].url, { waitUntil: "domcontentloaded" });
console.log("In the opened browser, complete any location or consent prompt and confirm season props are visible. Press Enter here when finished.");
process.stdin.setEncoding("utf8");
await new Promise((resolve) => process.stdin.once("data", resolve));
await context.close();
