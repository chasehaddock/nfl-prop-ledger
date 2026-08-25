import assert from "node:assert/strict";
import test from "node:test";
import {
  SLEEPER_REDRAFT_FORMAT,
  buildSleeperAdpPublic,
  normalizeSleeperAdpRows,
  validateSleeperAdpPair,
  verifiedSleeperAdpSnapshot,
} from "../lib/sleeper-adp.mjs";

function rows(adpShift = 0) {
  const positions = ["QB", "RB", "WR", "TE"];
  return Array.from({ length: 260 }, (_, index) => ({
    rank: index + 1,
    name: `Player ${index + 1}`,
    team: "BUF",
    position: positions[index % positions.length],
    adp: index + 1 + adpShift,
    bye: 7,
    sleeperPoints: 300 - index / 2,
  }));
}

function capture(capturedAt, captureRows = rows()) {
  return {
    source: "sleeper",
    capturedAt,
    format: SLEEPER_REDRAFT_FORMAT,
    pages: [{ id: "redraft-adp", rows: captureRows }],
  };
}

test("normalizes and caps Sleeper ADP to the top 250 QB/RB/WR/TE players", () => {
  const normalized = normalizeSleeperAdpRows([...rows(), { name: "Defense", position: "DEF", adp: 1 }]);
  assert.equal(normalized.length, 250);
  assert.equal(normalized[0].name, "Player 1");
  assert.equal(normalized.at(-1).name, "Player 250");
  assert.equal(normalized[0].id, "qb:player-1");
});

test("verifies matching full-PPR, four-point passing-TD capture passes", () => {
  const primary = capture("2026-08-24T13:17:00.000Z");
  const confirmation = capture("2026-08-24T13:18:00.000Z");
  assert.deepEqual(validateSleeperAdpPair(primary, confirmation), []);
  const snapshot = verifiedSleeperAdpSnapshot(primary, confirmation, "2026-08-24");
  assert.equal(snapshot.players.length, 250);
  assert.equal(snapshot.format.slots.K, 0);
  assert.equal(snapshot.format.slots.DEF, 0);
});

test("rejects the wrong Sleeper draft format", () => {
  const primary = capture("2026-08-24T13:17:00.000Z");
  const confirmation = capture("2026-08-24T13:18:00.000Z");
  confirmation.format = { ...SLEEPER_REDRAFT_FORMAT, passingTdPoints: 6 };
  assert.ok(validateSleeperAdpPair(primary, confirmation).some((error) => error.includes("draft format")));
});

test("builds daily ADP history and treats a lower ADP as a rise", () => {
  const first = verifiedSleeperAdpSnapshot(capture("2026-08-23T13:17:00.000Z"), capture("2026-08-23T13:18:00.000Z"), "2026-08-23");
  const changedRows = rows();
  changedRows[0] = { ...changedRows[0], adp: 0.8 };
  const second = verifiedSleeperAdpSnapshot(capture("2026-08-24T13:17:00.000Z", changedRows), capture("2026-08-24T13:18:00.000Z", changedRows), "2026-08-24");
  const published = buildSleeperAdpPublic([first, second]);
  assert.equal(published.current.players.length, 250);
  assert.equal(published.history["qb:player-1"].length, 2);
  assert.equal(published.current.movements[0].changeType, "adp_risen");
  assert.equal(published.current.movements[0].adpDelta, -0.2);
});
