import assert from "node:assert/strict";
import test from "node:test";
import { calculateFantasyPoints, combineTouchdownProbabilities, fairOverProbability, lineCenteredExpectation, requiredFantasyStats } from "../src/fantasy.ts";

test("removes the vig from two-sided touchdown prices", () => {
  assert.equal(fairOverProbability(-110, -110), 0.5);
  assert.ok(Math.abs(fairOverProbability(-140, 110) - 0.55357) < 0.00001);
  assert.ok(Math.abs(fairOverProbability(106, -140) - 0.45105) < 0.00001);
});

test("adjusts a passing touchdown line above or below its market midpoint after removing vig", () => {
  const fairOver = fairOverProbability(106, -140);
  const expectedTouchdowns = lineCenteredExpectation(1.5, fairOver);
  assert.ok(Math.abs(fairOver - 0.45105178) < 0.00000001);
  assert.ok(Math.abs(expectedTouchdowns - 1.45105178) < 0.00000001);
  assert.ok(expectedTouchdowns < 1.5);
  assert.ok(lineCenteredExpectation(1.5, 0.55) > 1.5);
});

test("estimates an any-touchdown probability from separate rushing and receiving markets", () => {
  assert.ok(Math.abs(combineTouchdownProbabilities(0.3, 0.2) - 0.44) < 0.00001);
});

test("calculates full-PPR wide receiver and tight end season points", () => {
  const lines = { receiving_yards: 1375.5, receptions: 101.5, receiving_touchdowns: 10.5 };
  assert.equal(calculateFantasyPoints("WR", lines), 302.05);
  assert.equal(calculateFantasyPoints("TE", lines), 302.05);
});

test("calculates running back points from rushing yards, receptions, and rushing touchdowns", () => {
  assert.equal(calculateFantasyPoints("RB", {
    rushing_yards: 1225.5,
    receptions: 46.5,
    rushing_touchdowns: 11.5,
  }), 238.05);
  assert.equal(calculateFantasyPoints("RB", {
    rushing_yards: 1225.5,
    receptions: 46.5,
    rushing_touchdowns: 11.5,
    receiving_yards: 425.5,
    receiving_touchdowns: 2.5,
  }), 295.6);
});

test("uses a combined offensive touchdown projection without double-counting separate touchdown lines", () => {
  assert.equal(calculateFantasyPoints("RB", {
    rushing_yards: 1000,
    receiving_yards: 400,
    receptions: 50,
    rushing_touchdowns: 8,
    receiving_touchdowns: 2,
    offensive_touchdowns: 9,
  }), 244);
  assert.equal(calculateFantasyPoints("WR", {
    receiving_yards: 1000,
    receptions: 80,
    offensive_touchdowns: 7,
  }), 222);
});

test("calculates quarterback points with different passing and rushing touchdown weights", () => {
  assert.equal(calculateFantasyPoints("QB", {
    passing_yards: 4275.5,
    passing_touchdowns: 31.5,
    rushing_yards: 425.5,
    rushing_touchdowns: 2.5,
  }), 354.57);
  assert.equal(calculateFantasyPoints("QB", {
    passing_yards: 4275.5,
    passing_touchdowns: 31.5,
    rushing_yards: 425.5,
  }), 339.57);
  assert.equal(calculateFantasyPoints("QB", {
    passing_yards: 4275.5,
    passing_touchdowns: 31.5,
  }), 297.02);
});

test("adds optional receiver rushing production when a verified prop exists", () => {
  assert.equal(calculateFantasyPoints("WR", {
    receiving_yards: 1375.5,
    receptions: 101.5,
    receiving_touchdowns: 10.5,
    rushing_yards: 75.5,
    rushing_touchdowns: 1.5,
  }), 318.6);
});

test("returns no projection when any required position stat is absent", () => {
  assert.equal(calculateFantasyPoints("WR", { receiving_yards: 1375.5, receptions: 101.5 }), null);
  assert.equal(calculateFantasyPoints("RB", { rushing_yards: 1225.5, rushing_touchdowns: 11.5 }), null);
  assert.equal(calculateFantasyPoints("QB", { passing_yards: 4275.5 }), null);
  assert.deepEqual(requiredFantasyStats("QB"), ["passing_yards", "passing_touchdowns"]);
});
