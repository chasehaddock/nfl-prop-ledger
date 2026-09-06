import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PRIZEPICKS_MARKETS } from "../collector/prizepicks-config.mjs";
import { UNDERDOG_MARKETS } from "../collector/underdog-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capturedAt = "2026-08-19T14:17:00.000Z";

async function processRaw(raw) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prop-ledger-test-"));
  const input = path.join(directory, "raw.json");
  const output = path.join(directory, "capture.json");
  await writeFile(input, JSON.stringify(raw));
  const result = spawnSync(process.execPath, ["scripts/process-browser-capture.mjs", input, output], {
    cwd: root,
    encoding: "utf8",
  });
  const capture = result.status === 0 ? JSON.parse(await readFile(output, "utf8")) : null;
  return { result, capture };
}

test("processes a complete PrizePicks projection envelope", async () => {
  const rows = [
    { playerName: "Jared Goff", line: "4075.5", statLabel: "Pass Yards" },
    { playerName: "Jared Goff", line: "28.5", statLabel: "Pass TDs" },
    { playerName: "Derrick Henry", line: "1175.5", statLabel: "Rush Yards" },
    { playerName: "Derrick Henry", line: "11.5", statLabel: "Rush TDs" },
    { playerName: "Amon-Ra St. Brown", line: "1125.5", statLabel: "Rec Yards" },
    { playerName: "Amon-Ra St. Brown", line: "8.5", statLabel: "Rec TDs" },
    { playerName: "Amon-Ra St. Brown", line: "94.5", statLabel: "Receptions" },
  ];
  const { result, capture } = await processRaw({
    source: "prizepicks",
    season: 2026,
    capturedAt,
    pages: [{ ...PRIZEPICKS_MARKETS[0], capturedAt, rows }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(capture.source, "prizepicks");
  assert.equal(capture.providerType, "projection");
  assert.equal(capture.observations.length, 7);
  assert.equal(capture.observations[0].overOdds, undefined);
});

test("processes Underdog Week 1 projections and normalized modifiers", async () => {
  const rows = [
    { playerName: "Jaxon Smith-Njigba", statLabel: "Rush + Rec TDs", line: 0.5, higherMultiplier: 1.13, lowerMultiplier: 0.83 },
    { playerName: "Dak Prescott", statLabel: "Pass TDs", line: 1.5, higherMultiplier: 0.89, lowerMultiplier: 1.08 },
    { playerName: "Dak Prescott", statLabel: "Pass Yards", line: 255.5, higherMultiplier: 0.95, lowerMultiplier: 1.02 },
    { playerName: "Dak Prescott", statLabel: "Rush Yards", line: 8.5, higherMultiplier: 1.04, lowerMultiplier: 0.93 },
    { playerName: "Jaxon Smith-Njigba", statLabel: "Receiving Yards", line: 82.5, higherMultiplier: 0.91, lowerMultiplier: 1.05 },
    { playerName: "Jaxon Smith-Njigba", statLabel: "Receptions", line: 6.5, higherMultiplier: 0.83, lowerMultiplier: 1.12 },
  ];
  const { result, capture } = await processRaw({
    source: "underdog",
    season: 2026,
    capturedAt,
    pages: [{ ...UNDERDOG_MARKETS[0], capturedAt, rows }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(capture.source, "underdog");
  assert.equal(capture.providerType, "multiplier");
  assert.equal(capture.observations.length, 6);
  assert.equal(capture.observations[0].normalizedProbability.toFixed(4), "0.4235");
});
