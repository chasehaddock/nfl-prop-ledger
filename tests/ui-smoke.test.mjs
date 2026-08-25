import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";

test("dashboard filters rows and opens the daily ledger directly below its player", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    assert.equal(await page.title(), "Prop Ledger — NFL Season Totals");
    assert.equal(await page.getByRole("heading", { name: "Line movement" }).count(), 1);
    const totalRows = await page.locator("tbody tr.data-row").count();
    assert.ok(totalRows > 0);
    assert.equal(await page.getByRole("columnheader", { name: /Calculated fantasy/i }).count(), 1);
    assert.equal(await page.getByRole("columnheader", { name: /PrizePicks fantasy score/i }).count(), 0);
    assert.ok(await page.locator(".fantasy-points").count() > 0);
    await page.getByRole("button", { name: "WR", exact: true }).click();
    const receiverRows = await page.locator("tbody tr.data-row").count();
    assert.ok(receiverRows > 0 && receiverRows <= totalRows);
    await page.getByPlaceholder("Search player or team").fill("Chase");
    assert.ok(await page.locator("tbody tr.data-row").count() > 0);
    assert.notEqual(await page.getByPlaceholder("Search player or team").evaluate((input) => getComputedStyle(input).color), "rgb(0, 0, 0)");
    assert.equal(await page.getByRole("button", { name: /Back to all players/i }).count(), 1);
    const ledgerButton = page.locator(".ledger-link").first();
    await ledgerButton.click();
    await page.getByRole("heading", { name: /Ja'Marr Chase/ }).waitFor();
    assert.equal(await ledgerButton.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator("tbody tr.data-row + tr.history-row").count(), 1);
    assert.match(await page.locator(".inline-history").innerText(), /receiving yards/i);
    await page.getByRole("button", { name: /Collapse Ja'Marr Chase ledger/ }).click();
    assert.equal(await page.locator("tbody tr.history-row").count(), 0);
  } finally {
    await browser.close();
  }
});

test("every visible category sorts and reverses without lifting missing values", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    const yardsHeader = page.getByRole("columnheader", { name: /^Yards/i });
    assert.equal(await yardsHeader.getAttribute("aria-sort"), "descending");
    const descending = await page.locator("tbody tr.data-row td:nth-child(3) .number-cell strong").allTextContents();
    assert.ok(Number(descending[0].replaceAll(",", "")) >= Number(descending.at(-1).replaceAll(",", "")));
    await yardsHeader.getByRole("button").click();
    assert.equal(await yardsHeader.getAttribute("aria-sort"), "ascending");
    const ascending = await page.locator("tbody tr.data-row td:nth-child(3) .number-cell strong").allTextContents();
    assert.ok(Number(ascending[0].replaceAll(",", "")) <= Number(ascending.at(-1).replaceAll(",", "")));

    for (const label of ["Player", "Source", "Receptions / QB rush yards", "Touchdowns"]) {
      const header = page.getByRole("columnheader", { name: new RegExp(label, "i") });
      await header.getByRole("button").click();
      assert.notEqual(await header.getAttribute("aria-sort"), "none");
    }
    const fantasyHeader = page.getByRole("columnheader", { name: /Calculated fantasy/i });
    await fantasyHeader.getByRole("button").click();
    const fantasyCells = await page.locator("tbody tr.data-row td:nth-child(6)").allTextContents();
    const isUnrankable = (value) => /Not assigned|Not enough verified data/i.test(value);
    const firstMissing = fantasyCells.findIndex(isUnrankable);
    assert.ok(firstMissing === -1 || fantasyCells.slice(firstMissing).every(isUnrankable));
    const statusHeader = page.getByRole("columnheader", { name: /Confidence/i });
    await statusHeader.getByRole("button").click();
    assert.notEqual(await statusHeader.getAttribute("aria-sort"), "none");
  } finally {
    await browser.close();
  }
});

test("a prop opens every current source line and explains the consensus", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByPlaceholder("Search player or team").fill("Jared Goff");
    const row = page.locator("tbody tr.data-row").filter({ hasText: "Jared Goff" }).first();
    assert.match(await row.locator("td:nth-child(3)").innerText(), /4 sources · arithmetic average/i);
    await row.getByRole("button", { name: /Compare Jared Goff Pass yards across sources/i }).click();
    const drawer = page.getByRole("dialog", { name: /Jared Goff Pass yards line trend/i });
    await drawer.waitFor();
    const comparison = drawer.locator(".prop-comparison");
    await comparison.getByRole("heading", { name: /Jared Goff · Pass yards/i }).waitFor();
    assert.equal(await page.locator("tbody tr.history-row").count(), 0);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    assert.match(await comparison.locator(".consensus-summary").innerText(), /4,068\.75[\s\S]*arithmetic average of all 4 current sources/i);
    assert.equal(await comparison.locator(".source-comparison article").count(), 4);
    const text = await comparison.innerText();
    for (const source of ["BetMGM", "DraftKings", "FanDuel", "PrizePicks"]) assert.match(text, new RegExp(source));
    for (const source of ["draftkings", "fanduel", "betmgm", "prizepicks"]) assert.ok(await comparison.locator(`.source-${source}`).count() > 0);
    await comparison.getByRole("button", { name: /Back to all players/i }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.getByPlaceholder("Search player or team").inputValue(), "");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  } finally {
    await browser.close();
  }
});

test("quarterback rows replace receptions with rushing yards and expose rushing touchdowns", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "QB", exact: true }).click();
    assert.equal(await page.getByRole("columnheader", { name: /^Rushing yards/i }).count(), 1);
    assert.ok(await page.locator("tbody tr.data-row td:nth-child(4)").filter({ hasText: "Rush yds" }).count() > 0);
    assert.equal(await page.locator("tbody tr.data-row td:nth-child(4)").filter({ hasText: "Receptions" }).count(), 0);
    assert.ok(await page.locator("tbody tr.data-row td:nth-child(5)").filter({ hasText: "Rush TD" }).count() > 0);
    const shough = page.locator("tbody tr.data-row").filter({ hasText: "Tyler Shough" }).first();
    assert.match(await shough.locator("td:nth-child(4)").innerText(), /Not offered[\s\S]*Estimated 309\.7[\s\S]*50\/50 blend[\s\S]*W1 avg 17\.5\/G × 18 = 315[\s\S]*2025 NFL 16\.9\/G × 18 = 304\.4[\s\S]*sample: 11 games[\s\S]*final 309\.7/i);
    assert.match(await shough.locator("td:nth-child(6)").innerText(), /Not enough verified data[\s\S]*Est\.[\s\S]*excluded from fantasy rankings and sorting/i);
    assert.equal(await shough.locator(".projection-rank.incomplete").innerText(), "NR");
    const rodgers = page.locator("tbody tr.data-row").filter({ hasText: "Aaron Rodgers" }).first();
    assert.match(await rodgers.locator("td:nth-child(5)").innerText(), /Not offered[\s\S]*Rush TD[\s\S]*Estimated 1\.1[\s\S]*0\.1 rush TD\/G × 18 = 1\.1[\s\S]*sample: 16 games/i);
    const verifiedFantasyRow = page.locator("tbody tr.data-row:has(.fantasy-points:not(.inferred))").first();
    await verifiedFantasyRow.waitFor();
    const before = Number((await verifiedFantasyRow.locator(".fantasy-points").innerText()).replaceAll(",", ""));
    const scoringToggle = page.locator(".qb-scoring-toggle");
    assert.match(await scoringToggle.innerText(), /QB pass TDs[\s\S]*4 pts/i);
    await scoringToggle.click();
    assert.equal(await scoringToggle.getAttribute("aria-pressed"), "true");
    const after = Number((await verifiedFantasyRow.locator(".fantasy-points").innerText()).replaceAll(",", ""));
    assert.ok(after > before);
    assert.match(await verifiedFantasyRow.locator("td:nth-child(6)").innerText(), /Pass TDs · 6 pts/i);
  } finally {
    await browser.close();
  }
});

test("tight end premium recalculates TE fantasy points and is available on both boards", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "TE", exact: true }).click();
    const row = page.locator("tbody tr.data-row:has(td:nth-child(4) .number-cell strong):has(.fantasy-points)").first();
    await row.waitFor();
    const receptions = Number((await row.locator("td:nth-child(4) .number-cell strong").innerText()).replaceAll(",", ""));
    await page.locator(".tep-toggle").getByRole("button", { name: "0.0", exact: true }).click();
    const base = Number(await row.locator(".fantasy-points").innerText());
    await page.locator(".tep-toggle").getByRole("button", { name: "0.5", exact: true }).click();
    const half = Number(await row.locator(".fantasy-points").innerText());
    assert.ok(Math.abs(half - (base + receptions * 0.5)) < 0.02);
    await page.locator(".tep-toggle").getByRole("button", { name: "1.0", exact: true }).click();
    const full = Number(await row.locator(".fantasy-points").innerText());
    assert.ok(Math.abs(full - (base + receptions)) < 0.02);
    assert.match(await row.locator("td:nth-child(6)").innerText(), /TEP 1\.0 · 2\.0 total pts\/reception/i);
    assert.equal(await page.locator(".tep-toggle").getByRole("button", { name: "1.0", exact: true }).getAttribute("aria-pressed"), "true");
    assert.match(await page.getByRole("columnheader", { name: /Calculated fantasy/i }).innerText(), /TEP 1\.0 · season/i);
    await page.getByRole("button", { name: /Weekly Week 1 projections/i }).click();
    assert.equal(await page.locator(".tep-toggle").count(), 1);
    assert.equal(await page.locator(".tep-toggle").getByRole("button", { name: "1.0", exact: true }).getAttribute("aria-pressed"), "true");
    assert.match(await page.getByRole("columnheader", { name: /Calculated fantasy/i }).innerText(), /TEP 1\.0 · Week 1/i);
  } finally {
    await browser.close();
  }
});

test("base PPR recalculates RB, WR, and TE fantasy points and persists across projection boards", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    const pprToggle = page.locator(".ppr-toggle");
    assert.equal(await pprToggle.getByRole("button", { name: "1.0", exact: true }).getAttribute("aria-pressed"), "true");

    await page.getByRole("button", { name: "RB", exact: true }).click();
    const row = page.locator("tbody tr.data-row:has(td:nth-child(4) .number-cell strong):has(.fantasy-points:not(.inferred))").first();
    await row.waitFor();
    const receptions = Number((await row.locator("td:nth-child(4) .number-cell strong").innerText()).replaceAll(",", ""));
    const full = Number(await row.locator(".fantasy-points").innerText());

    await pprToggle.getByRole("button", { name: "0.5", exact: true }).click();
    const half = Number(await row.locator(".fantasy-points").innerText());
    assert.ok(Math.abs(half - (full - receptions * 0.5)) < 0.02);

    await pprToggle.getByRole("button", { name: "0.0", exact: true }).click();
    const standard = Number(await row.locator(".fantasy-points").innerText());
    assert.ok(Math.abs(standard - (full - receptions)) < 0.02);
    assert.match(await row.locator("td:nth-child(6)").innerText(), /PPR 0\.0 · 0\.0 pts\/reception/i);
    assert.match(await page.getByRole("columnheader", { name: /Calculated fantasy/i }).innerText(), /0\.0 PPR/i);

    await page.getByRole("button", { name: /Weekly Week 1 projections/i }).click();
    assert.equal(await page.locator(".ppr-toggle").getByRole("button", { name: "0.0", exact: true }).getAttribute("aria-pressed"), "true");
    assert.match(await page.getByRole("columnheader", { name: /Calculated fantasy/i }).innerText(), /0\.0 PPR[\s\S]*Week 1/i);
  } finally {
    await browser.close();
  }
});

test("verified fantasy projections receive position ranks while incomplete or inferred rows are NR", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "WR", exact: true }).click();
    await page.getByRole("columnheader", { name: /Calculated fantasy/i }).getByRole("button").click();
    const seasonRanks = await page.locator("tbody tr.data-row .projection-rank.ranked").allTextContents();
    assert.ok(seasonRanks.length > 1);
    assert.deepEqual(seasonRanks.slice(0, 5), seasonRanks.slice(0, 5).map((_, index) => `WR${index + 1}`));

    await page.getByRole("button", { name: /Weekly Week 1 projections/i }).click();
    await page.getByRole("button", { name: "WR", exact: true }).click();
    await page.getByRole("columnheader", { name: /Calculated fantasy/i }).getByRole("button").click();
    const weeklyRanks = await page.locator("tbody tr.data-row .projection-rank.ranked").allTextContents();
    assert.ok(weeklyRanks.length > 0);
    assert.deepEqual(weeklyRanks.slice(0, 5), weeklyRanks.slice(0, 5).map((_, index) => `WR${index + 1}`));
    assert.equal(
      await page.locator("tbody tr.data-row .projection-rank").count(),
      await page.locator("tbody tr.data-row").count(),
    );
    assert.ok(await page.locator("tbody tr.data-row .projection-rank.incomplete").count() > 0);
  } finally {
    await browser.close();
  }
});

test("zero inferred rushing yards stay implicit for receivers and tight ends", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "TE", exact: true }).click();
    const laporta = page.locator("tbody tr.data-row").filter({ hasText: "Sam LaPorta" }).first();
    assert.doesNotMatch(await laporta.locator("td:nth-child(3)").innerText(), /Rush yds/i);
    assert.doesNotMatch(await laporta.locator("td:nth-child(6)").innerText(), /Rush yards/i);
    await laporta.locator(".ledger-link").click();
    const ledger = page.locator(".inline-history");
    await ledger.waitFor();
    assert.equal(await ledger.getByRole("heading", { name: "Rushing yards", exact: true }).count(), 0);
    await page.getByRole("button", { name: /Collapse Sam LaPorta ledger/ }).click();
    const dulcich = page.locator("tbody tr.data-row").filter({ hasText: "Greg Dulcich" }).first();
    assert.doesNotMatch(await dulcich.locator("td:nth-child(3)").innerText(), /-14|Rush yds/i);
    assert.doesNotMatch(await dulcich.locator("td:nth-child(6)").innerText(), /-14|Rush yards/i);
  } finally {
    await browser.close();
  }
});

test("skill players show total touchdowns with the rushing and receiving split", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "RB", exact: true }).click();
    assert.ok(await page.locator("tbody tr.data-row td:nth-child(3)").filter({ hasText: "Rec yds" }).count() > 0);
    assert.ok(await page.locator("tbody tr.data-row td:nth-child(5) .total-touchdowns").count() > 0);
    assert.ok(await page.locator("tbody tr.data-row td:nth-child(5)").filter({ hasText: "Total TDs" }).count() > 0);
    const inferred = page.locator("tbody tr.data-row").filter({ hasText: "Kyren Williams" }).first().locator("td:nth-child(5)");
    assert.match(await inferred.innerText(), /12\.5[\s\S]*Total TDs[\s\S]*Rush 9\.5 · Rec —[\s\S]*Inferred from PrizePicks: 12.5 total − 9.5 rushing TDs = 3/i);
    const kyrenRow = page.locator("tbody tr.data-row").filter({ hasText: "Kyren Williams" }).first();
    assert.match(await kyrenRow.locator("td:nth-child(6)").innerText(), /Not enough verified data[\s\S]*Est\.[\s\S]*excluded from fantasy rankings and sorting/i);
    assert.equal(await kyrenRow.locator(".projection-rank.incomplete").innerText(), "NR");

    const etienne = page.locator("tbody tr.data-row").filter({ hasText: "Travis Etienne" }).first().locator("td:nth-child(5)");
    assert.match(await etienne.innerText(), /5\.38[\s\S]*Total TDs[\s\S]*Rush 5\.38 · Rec —/i);
    assert.doesNotMatch(await etienne.innerText(), /2025 NFL|prior-season|6 rec TD/i);

    await page.getByRole("button", { name: "WR", exact: true }).click();
    const receiver = page.locator("tbody tr.data-row td:nth-child(5) .total-touchdowns").first();
    assert.match(await receiver.innerText(), /Total TDs[\s\S]*Rush .* · Rec /i);
    const diggs = page.locator("tbody tr.data-row").filter({ hasText: "Stefon Diggs" }).first().locator("td:nth-child(5)");
    assert.match(await diggs.innerText(), /4\.5[\s\S]*Total TDs[\s\S]*Rush — · Rec 4\.5/i);
    assert.doesNotMatch(await diggs.innerText(), /2025 NFL|Inferred.*0|Rush 0/i);

    const wandale = page.locator("tbody tr.data-row").filter({ hasText: /Wan.Dale Robinson/i }).first();
    if (await wandale.count()) {
      assert.doesNotMatch(await wandale.locator("td:nth-child(4)").innerText(), /2025 NFL|pace|sample:/i);
    }
  } finally {
    await browser.close();
  }
});

test("running backs use labeled 18-game NFL receiving pace only when no market line exists", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "RB", exact: true }).click();
    const veteran = page.locator("tbody tr.data-row").filter({ hasText: "Jaylen Warren" }).first();
    assert.match(await veteran.locator("td:nth-child(3)").innerText(), /374\.6[\s\S]*2025 NFL · 333 yds \/ 16 G × 18 = 374\.6/i);
    assert.match(await veteran.locator("td:nth-child(4)").innerText(), /45[\s\S]*2025 NFL · 40 rec \/ 16 G × 18 = 45/i);
    assert.match(await veteran.locator("td:nth-child(6)").innerText(), /Uses 18-game 2025 NFL pace: receptions \+ receiving yards/i);
    const sportsbook = page.locator("tbody tr.data-row").filter({ hasText: "Bijan Robinson" }).first();
    assert.doesNotMatch(await sportsbook.locator("td:nth-child(3)").innerText(), /2025 NFL/i);
    assert.doesNotMatch(await sportsbook.locator("td:nth-child(4)").innerText(), /2025 NFL/i);
    const rookie = page.locator("tbody tr.data-row").filter({ hasText: "Jeremiyah Love" }).first();
    assert.doesNotMatch(await rookie.locator("td:nth-child(4)").innerText(), /2025/i);
  } finally {
    await browser.close();
  }
});

test("line movement toggles between today, week, and all history", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    const card = page.locator(".trend-card");
    for (const range of ["Today", "Week", "All history"]) {
      await card.getByRole("button", { name: range, exact: true }).click();
      await page.waitForTimeout(100);
      const counts = await card.locator(".trend-counts").innerText();
      const match = counts.match(/(\d+) UP[\s\S]*?(\d+) DOWN/i);
      assert.ok(match);
      assert.equal(await card.locator(".trend-list li").count(), Number(match[1]) + Number(match[2]));
      assert.equal(await card.getByRole("button", { name: range, exact: true }).getAttribute("aria-pressed"), "true");
    }
    assert.equal(await card.getByRole("button", { name: "All history", exact: true }).getAttribute("aria-pressed"), "true");
    const movement = card.locator(".trend-list button").first();
    const movementLabel = await movement.getAttribute("aria-label");
    await movement.click();
    const drawer = page.getByRole("dialog");
    await drawer.waitFor();
    const chart = drawer.locator(".line-history-chart");
    await chart.getByRole("heading", { name: "Line trend" }).waitFor();
    assert.equal(await chart.locator("svg").count(), 1);
    assert.ok(await chart.locator(".chart-point").count() >= 2);
    assert.ok(await chart.locator(".chart-segment").count() >= 1);
    assert.match(await chart.locator(".line-chart-series").innerText(), /Average of all sportsbooks · monitored trend/i);
    assert.ok(await chart.locator(".chart-average").count() > 0);
    assert.ok(movementLabel);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  } finally {
    await browser.close();
  }
});

test("desktop keeps line movement beside the player board and scrolls it independently", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 820 } });
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    const trend = page.locator(".trend-column");
    const ledger = page.locator(".ledger");
    const [trendBox, ledgerBox] = await Promise.all([trend.boundingBox(), ledger.boundingBox()]);
    assert.ok(trendBox && ledgerBox);
    assert.ok(trendBox.x + trendBox.width < ledgerBox.x);
    assert.ok(Math.abs(trendBox.y - ledgerBox.y) < 3);

    const card = trend.locator(".trend-card");
    await card.getByRole("button", { name: "All history", exact: true }).click();
    const list = card.locator(".trend-list");
    assert.equal(await list.evaluate((element) => getComputedStyle(element).overflowY), "auto");
    const metrics = await list.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    assert.ok(metrics.scrollHeight > metrics.clientHeight);
    assert.ok((await card.boundingBox())?.height <= 786);
  } finally {
    await browser.close();
  }
});

test("filters and table headers stay visible while the ledger scrolls and confidence is labeled", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    assert.equal(await page.locator(".filters").evaluate((element) => getComputedStyle(element).position), "sticky");
    assert.equal(await page.locator("thead th").first().evaluate((element) => getComputedStyle(element).position), "sticky");
    assert.match(await page.locator(".table-wrap").evaluate((element) => getComputedStyle(element).overflow), /auto/);
    assert.equal(await page.getByRole("columnheader", { name: /Confidence/i }).count(), 1);
    assert.ok(await page.locator(".confidence.strong, .confidence.partial, .confidence.thin").count() > 0);
    const tableWrap = page.locator(".table-wrap");
    await tableWrap.evaluate((element) => { element.scrollLeft = 500; });
    const [horizontalWrapBox, playerHeaderBox, playerCellBox] = await Promise.all([tableWrap.boundingBox(), page.locator("thead th").first().boundingBox(), page.locator("tbody tr.data-row > td").first().boundingBox()]);
    assert.ok(horizontalWrapBox && playerHeaderBox && playerCellBox);
    assert.ok(Math.abs(playerHeaderBox.x - horizontalWrapBox.x) < 3);
    assert.ok(Math.abs(playerCellBox.x - horizontalWrapBox.x) < 3);
    await tableWrap.evaluate((element) => { element.scrollTop = 500; });
    const [wrapBox, headerBox] = await Promise.all([tableWrap.boundingBox(), page.locator("thead th").first().boundingBox()]);
    assert.ok(wrapBox && headerBox);
    assert.ok(Math.abs(headerBox.y - wrapBox.y) < 3);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    const mobileWrap = mobile.locator(".table-wrap");
    await mobileWrap.evaluate((element) => { element.scrollLeft = 900; });
    const mobileScrollLeft = await mobileWrap.evaluate((element) => element.scrollLeft);
    const [mobileWrapBox, mobileHeaderBox, mobilePlayerBox] = await Promise.all([mobileWrap.boundingBox(), mobile.locator("thead th").first().boundingBox(), mobile.locator("tbody tr.data-row > td").first().boundingBox()]);
    assert.ok(mobileScrollLeft > 300);
    assert.ok(mobileWrapBox && mobileHeaderBox && mobilePlayerBox);
    assert.ok(Math.abs(mobileHeaderBox.x - mobileWrapBox.x) < 3);
    assert.ok(Math.abs(mobilePlayerBox.x - mobileWrapBox.x) < 3);
    assert.ok(mobilePlayerBox.width <= 165);
    await mobile.close();
  } finally {
    await browser.close();
  }
});

test("Week 1 has a separate data-ready board and movement history", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Weekly Week 1 projections/i }).click();
    await page.getByRole("heading", { name: "Week 1 projections" }).waitFor();
    assert.ok(await page.locator("tbody tr.data-row").count() > 0);
    assert.equal(await page.getByRole("columnheader", { name: /TD chance/i }).count(), 1);
    assert.equal(await page.getByRole("columnheader", { name: /PrizePicks fantasy score/i }).count(), 1);
    assert.ok(await page.locator("tbody tr.data-row td:nth-child(5) .touchdown-chance").count() > 0);
    assert.match(await page.locator("tbody tr.data-row td:nth-child(5) .touchdown-chance").first().innerText(), /%[\s\S]*scores any rush\/rec TD/i);
    await page.getByPlaceholder("Search player or team").fill("Sam Darnold");
    const darnoldTdCell = page.locator("tbody tr.data-row").filter({ hasText: "Sam Darnold" }).first().locator("td:nth-child(5)");
    assert.equal(await darnoldTdCell.locator(".passing-td-expectation").count(), 1);
    assert.match(await darnoldTdCell.innerText(), /1\.45[\s\S]*Expected pass TDs · FanDuel no-vig/i);
    assert.doesNotMatch(await darnoldTdCell.innerText(), /Pass TD · 4 pts|O 1\.5|U 1\.5/i);
    await page.getByPlaceholder("Search player or team").fill("");
    assert.ok(await page.locator("tbody tr.data-row td:nth-child(7) .number-cell").count() > 0);
    const weeklyTrend = page.locator(".trend-card");
    await weeklyTrend.getByRole("button", { name: "All history", exact: true }).click();
    const counts = await weeklyTrend.locator(".trend-counts").innerText();
    const countMatch = counts.match(/(\d+) UP[\s\S]*?(\d+) DOWN/i);
    assert.ok(countMatch);
    assert.ok(Number(countMatch[1]) + Number(countMatch[2]) > 0);
    assert.equal(await weeklyTrend.locator(".trend-list li").count(), Number(countMatch[1]) + Number(countMatch[2]));
    assert.match(await weeklyTrend.locator(".trend-list").innerText(), /PrizePicks/i);
    assert.match(await page.getByRole("columnheader", { name: /Calculated fantasy/i }).innerText(), /Week 1/i);
    await page.getByRole("button", { name: /Season Season totals/i }).click();
    assert.ok(await page.locator("tbody tr.data-row").count() > 0);
    assert.equal(await page.getByRole("columnheader", { name: /PrizePicks fantasy score/i }).count(), 0);
  } finally {
    await browser.close();
  }
});

test("Sleeper redraft is a separate 12-team positional value board", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.TEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Sleeper redraft/i }).click();
    await page.getByRole("heading", { name: "Sleeper redraft" }).waitFor();
    assert.match(await page.locator("main").innerText(), /12-team[\s\S]*full-PPR[\s\S]*4-point passing TDs/i);
    assert.match(await page.locator(".sleeper-format-chip").innerText(), /no K\/DST/i);
    assert.equal(await page.getByRole("columnheader", { name: /Sleeper pos rank/i }).count(), 1);
    assert.equal(await page.getByRole("columnheader", { name: /^Comparable ADP rank/i }).count(), 1);
    assert.equal(await page.getByRole("columnheader", { name: /^Our comparable rank/i }).count(), 1);
    assert.equal(await page.getByRole("columnheader", { name: /Value gap/i }).count(), 1);
    assert.match(await page.locator(".coverage-explainer").innerText(), /same complete-player pool/i);
    assert.equal(await page.getByRole("button", { name: "Needs data", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Needs data", exact: true }).click();
    assert.ok(await page.locator("tbody tr.data-row").count() > 0);
    assert.equal(await page.locator("tbody tr.data-row .needs-data-badge").count(), await page.locator("tbody tr.data-row").count());
    assert.match(await page.locator("tbody tr.data-row").first().innerText(), /receptions|yards|TDs|inferred inputs|No ledger match/i);
    assert.ok(await page.locator("tbody tr.data-row .fantasy-points.inferred").count() > 0);
    await page.getByRole("button", { name: "Comparable only", exact: true }).click();
    const comparable = page.locator("tbody tr.data-row").first();
    assert.match(await comparable.locator("td:nth-child(4)").innerText(), /(QB|RB|WR|TE)\d+/i);
    assert.match(await comparable.locator("td:nth-child(6)").innerText(), /(QB|RB|WR|TE)\d+/i);
    assert.doesNotMatch(await comparable.locator("td:nth-child(7)").innerText(), /Needs data/i);
    assert.match(await page.locator(".trend-card").innerText(), /ADP movement/i);
  } finally {
    await browser.close();
  }
});
