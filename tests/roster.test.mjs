import assert from "node:assert/strict";
import test from "node:test";
import { buildRosterIndex } from "../collector/roster.mjs";

test("indexes official full-name aliases without changing player identity", () => {
  const player = {
    id: "00-0040676",
    name: "Cam Ward",
    team: "TEN",
    position: "QB",
    aliases: ["Cam Ward", "Cameron Ward"],
  };
  const index = buildRosterIndex([player]);
  assert.equal(index.get("cam ward"), player);
  assert.equal(index.get("cameron ward"), player);
});
