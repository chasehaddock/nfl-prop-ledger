import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_CAPTURE_SOURCES,
  observationAllowedBySourcePolicy,
  sourceAllowedForScope,
} from "../lib/source-policy.mjs";

test("uses PrizePicks for season props and PrizePicks plus Underdog for Week 1", () => {
  assert.deepEqual(ACTIVE_CAPTURE_SOURCES, ["prizepicks", "underdog"]);
  assert.equal(sourceAllowedForScope("prizepicks", "regular_season"), true);
  assert.equal(sourceAllowedForScope("fanduel", "regular_season"), false);
  assert.equal(sourceAllowedForScope("underdog", "regular_season"), false);
  assert.equal(sourceAllowedForScope("draftkings", "regular_season"), false);
  for (const source of ACTIVE_CAPTURE_SOURCES) assert.equal(sourceAllowedForScope(source, "week_1"), true);
  assert.equal(sourceAllowedForScope("fanduel", "week_1"), false);
});

test("defaults legacy observations to the season policy", () => {
  assert.equal(observationAllowedBySourcePolicy({ source: "prizepicks" }), true);
  assert.equal(observationAllowedBySourcePolicy({ source: "draftkings" }), false);
  assert.equal(observationAllowedBySourcePolicy({ source: "fanduel" }), false);
  assert.equal(observationAllowedBySourcePolicy({ source: "fanduel", marketScope: "week_1" }), false);
  assert.equal(observationAllowedBySourcePolicy({ source: "underdog", marketScope: "week_1" }), true);
});
