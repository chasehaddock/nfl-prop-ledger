import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_CAPTURE_SOURCES,
  observationAllowedBySourcePolicy,
  sourceAllowedForScope,
} from "../lib/source-policy.mjs";

test("uses PrizePicks alone for season props and three sources for Week 1", () => {
  assert.deepEqual(ACTIVE_CAPTURE_SOURCES, ["prizepicks", "fanduel", "underdog"]);
  assert.equal(sourceAllowedForScope("prizepicks", "regular_season"), true);
  assert.equal(sourceAllowedForScope("fanduel", "regular_season"), false);
  assert.equal(sourceAllowedForScope("underdog", "regular_season"), false);
  assert.equal(sourceAllowedForScope("draftkings", "regular_season"), false);
  for (const source of ACTIVE_CAPTURE_SOURCES) assert.equal(sourceAllowedForScope(source, "week_1"), true);
  assert.equal(sourceAllowedForScope("draftkings", "week_1"), false);
});

test("defaults legacy observations to the season policy", () => {
  assert.equal(observationAllowedBySourcePolicy({ source: "prizepicks" }), true);
  assert.equal(observationAllowedBySourcePolicy({ source: "fanduel" }), false);
  assert.equal(observationAllowedBySourcePolicy({ source: "fanduel", marketScope: "week_1" }), true);
});
