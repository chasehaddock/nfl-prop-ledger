import assert from "node:assert/strict";
import test from "node:test";
import { parseBetMgmOutcome, parseBetMgmRows } from "../collector/adapters/betmgm.mjs";
import { normalizeName } from "../lib/ledger.mjs";

const player = { id: "00-0039075", name: "Puka Nacua", team: "LA", position: "WR" };
const rosterByName = new Map([[normalizeName(player.name), player]]);
const sourceUrl = "https://www.az.betmgm.com/en/sports/events/2026-27-nfl-regular-season-stats-19070789";

function row(overrides = {}) {
  return {
    statLabel: "Receiving yards O/U",
    playerName: "Puka Nacua",
    outcomes: [
      { title: "O 1350.5", odds: "-110", optionId: "2211609250" },
      { title: "U 1350.5", odds: "-110", optionId: "2211609251" },
    ],
    ...overrides,
  };
}

test("parses Puka Nacua's verified BetMGM Arizona receiving-yard line", () => {
  assert.deepEqual(parseBetMgmOutcome("O 1350.5"), { side: "over", line: 1350.5 });
  const result = parseBetMgmRows([row()], {
    rosterByName,
    sourceUrl,
    capturedAt: "2026-08-19T14:17:00.000Z",
    season: 2026,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations[0].line, 1350.5);
  assert.equal(result.observations[0].overOdds, -110);
  assert.equal(result.observations[0].underOdds, -110);
  assert.equal(result.observations[0].isMain, true);
  assert.equal(result.observations[0].player.id, player.id);
});

test("parses BetMGM receiving touchdowns independently", () => {
  const result = parseBetMgmRows([row({
    statLabel: "Receiving TDs",
    outcomes: [
      { title: "O 8.5", odds: "+105" },
      { title: "U 8.5", odds: "-125" },
    ],
  })], {
    rosterByName,
    sourceUrl,
    capturedAt: "2026-08-19T14:17:00.000Z",
    season: 2026,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations[0].statType, "receiving_touchdowns");
  assert.equal(result.observations[0].line, 8.5);
});

test("accepts BetMGM's trailing team abbreviation without changing player identity", () => {
  const result = parseBetMgmRows([{
    statLabel: "Receiving yards O/U",
    playerName: "Puka Nacua (LA)",
    outcomes: [{ title: "O 1350.5", odds: "-114" }, { title: "U 1350.5", odds: "-114" }],
  }], {
    rosterByName,
    sourceUrl,
    capturedAt: "2026-08-24T21:05:00.000Z",
    season: 2026,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.observations[0].player.id, player.id);
});

test("rejects mismatched lines, duplicate markets, and unsupported stat labels", () => {
  const mismatched = parseBetMgmRows([row({
    outcomes: [
      { title: "O 1350.5", odds: "-110" },
      { title: "U 1325.5", odds: "-110" },
    ],
  })], { rosterByName, sourceUrl, capturedAt: "2026-08-19T14:17:00.000Z", season: 2026 });
  assert.match(mismatched.errors[0], /same line/);

  const duplicate = parseBetMgmRows([row(), row()], {
    rosterByName,
    sourceUrl,
    capturedAt: "2026-08-19T14:17:00.000Z",
    season: 2026,
  });
  assert.match(duplicate.errors.join(" "), /Duplicate BetMGM main market/);

  const unsupported = parseBetMgmRows([row({ statLabel: "Longest reception" })], {
    rosterByName,
    sourceUrl,
    capturedAt: "2026-08-19T14:17:00.000Z",
    season: 2026,
  });
  assert.match(unsupported.errors[0], /Unsupported BetMGM stat label/);
});

test("rejects unknown players and missing required stat categories", () => {
  const result = parseBetMgmRows([row()], {
    rosterByName: new Map(),
    sourceUrl,
    capturedAt: "2026-08-19T14:17:00.000Z",
    season: 2026,
    requiredStatTypes: ["receiving_yards", "passing_yards"],
  });
  assert.match(result.errors.join(" "), /not in the verified NFL roster index/);
  assert.match(result.errors.join(" "), /Required BetMGM stat is missing/);
});
