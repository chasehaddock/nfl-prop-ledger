import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAmericanOdds,
  parseDraftKingsRows,
  parseMarketLabel,
} from "../collector/adapters/draftkings.mjs";
import { normalizeName } from "../lib/ledger.mjs";

const player = { id: "00-0039064", name: "Mike Evans", team: "TB", position: "WR" };
const rosterByName = new Map([[normalizeName(player.name), player]]);
const sourceUrl = "https://sportsbook.draftkings.com/leagues/football/nfl?category=futures";

function row(overrides = {}) {
  return {
    label: "NFL 2026/27 - Mike Evans Regular Season Receiving Yards",
    outcomes: [
      { title: "Over 824.5", odds: "−110" },
      { title: "Under 824.5", odds: "-110" },
    ],
    ...overrides,
  };
}

test("parses the exact season, player, stat, unicode price, and main line", () => {
  assert.deepEqual(parseMarketLabel(row().label), {
    season: 2026,
    playerName: "Mike Evans",
    statType: "receiving_yards",
  });
  assert.equal(parseAmericanOdds("−110"), -110);

  const result = parseDraftKingsRows([row()], {
    rosterByName,
    sourceUrl,
    expectedStatType: "receiving_yards",
    capturedAt: "2026-08-19T14:17:00.000Z",
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations[0].line, 824.5);
  assert.equal(result.observations[0].overOdds, -110);
  assert.equal(result.observations[0].isMain, true);
  assert.equal(result.observations[0].player.id, player.id);
});

test("accepts DraftKings' supported label dash variants", () => {
  assert.equal(
    parseMarketLabel("NFL 2026/27 – Mike Evans Regular Season Receiving Yards").playerName,
    "Mike Evans",
  );
  assert.equal(
    parseMarketLabel("NFL 2026/27 — Mike Evans Regular Season Receiving Yards").statType,
    "receiving_yards",
  );
});

test("rejects a stat page mismatch", () => {
  const result = parseDraftKingsRows([row()], {
    rosterByName,
    sourceUrl,
    expectedStatType: "receptions",
    capturedAt: "2026-08-19T14:17:00.000Z",
  });
  assert.equal(result.observations.length, 0);
  assert.match(result.errors[0], /Expected receptions/);
});

test("rejects mismatched over and under lines", () => {
  const result = parseDraftKingsRows([row({
    outcomes: [
      { title: "Over 824.5", odds: "-110" },
      { title: "Under 825.5", odds: "-110" },
    ],
  })], {
    rosterByName,
    sourceUrl,
    expectedStatType: "receiving_yards",
    capturedAt: "2026-08-19T14:17:00.000Z",
  });
  assert.match(result.errors[0], /same line/);
});

test("rejects an unknown player instead of silently creating one", () => {
  const result = parseDraftKingsRows([row()], {
    rosterByName: new Map(),
    sourceUrl,
    expectedStatType: "receiving_yards",
    capturedAt: "2026-08-19T14:17:00.000Z",
  });
  assert.match(result.errors[0], /not in the verified NFL roster index/);
});

test("ignores DraftKings' empty structural wrappers but not malformed markets", () => {
  const result = parseDraftKingsRows([
    row(),
    { label: "", outcomes: [] },
    { label: "", outcomes: [{ title: "Over 1.5", odds: "-110" }] },
  ], {
    rosterByName,
    sourceUrl,
    expectedStatType: "receiving_yards",
    capturedAt: "2026-08-19T14:17:00.000Z",
  });
  assert.equal(result.observations.length, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Unrecognized DraftKings market label/);
});
