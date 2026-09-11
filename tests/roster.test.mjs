import assert from "node:assert/strict";
import test from "node:test";
import { buildRosterIndex } from "../collector/roster.mjs";

test("maps Joshua Palmer to Josh Palmer's verified identity", () => {
  const player = { id: "00-0036988", name: "Josh Palmer", team: "BUF", position: "WR", aliases: ["Josh Palmer"] };
  const index = buildRosterIndex([player]);
  assert.equal(index.get("joshua palmer"), player);
  assert.equal(index.get("josh palmer"), player);
});

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

test("indexes common sportsbook nicknames against official roster identities", () => {
  const marquise = {
    id: "00-0035662",
    name: "Marquise Brown",
    team: "PHI",
    position: "WR",
    aliases: ["Marquise Brown"],
  };
  const gainwell = {
    id: "00-0036919",
    name: "Kenneth Gainwell",
    team: "TB",
    position: "RB",
    aliases: ["Kenneth Gainwell"],
  };
  const index = buildRosterIndex([marquise, gainwell]);

  assert.equal(index.get("hollywood brown"), marquise);
  assert.equal(index.get("kenny gainwell"), gainwell);
});
