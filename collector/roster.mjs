import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { normalizeName, SUPPORTED_POSITIONS } from "../lib/ledger.mjs";

const ROSTER_URL = (season) => `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;

function chooseRosterRows(rows, rosterSeason, fallback = false) {
  const players = new Map();
  for (const row of rows) {
    const position = String(row.position || "").toUpperCase();
    if (!SUPPORTED_POSITIONS.has(position) || !row.full_name) continue;
    const name = normalizeName(row.full_name);
    const current = players.get(name);
    if (!current || Number(row.week || 0) >= Number(current.week || 0)) players.set(name, row);
  }
  return [...players.values()].map((row) => ({
    id: row.gsis_id || normalizeName(row.full_name).replace(/\s+/g, "-"),
    name: row.full_name,
    team: fallback ? "—" : row.team || "FA",
    position: String(row.position).toUpperCase(),
    rosterSeason,
    aliases: [...new Set([
      row.full_name,
      [row.first_name, row.last_name].filter(Boolean).join(" "),
    ].filter(Boolean))],
  }));
}

async function downloadRoster(season) {
  const response = await fetch(ROSTER_URL(season), { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`roster download returned ${response.status} for ${season}`);
  return parse(await response.text(), { columns: true, skip_empty_lines: true });
}

export function buildRosterIndex(players) {
  const rosterByName = new Map();
  for (const player of players) {
    for (const alias of player.aliases?.length ? player.aliases : [player.name]) {
      const key = normalizeName(alias);
      if (!rosterByName.has(key)) rosterByName.set(key, player);
    }
  }
  return rosterByName;
}

export async function loadRoster(season) {
  const cacheDir = path.resolve("data/rosters");
  const cacheFile = path.join(cacheDir, `${season}.json`);
  await mkdir(cacheDir, { recursive: true });
  let players;

  try {
    const [currentRows, previousRows] = await Promise.all([downloadRoster(season), downloadRoster(season - 1)]);
    const current = chooseRosterRows(currentRows, season);
    const currentIds = new Set(current.map((player) => player.id));
    const fallback = chooseRosterRows(previousRows, season - 1, true).filter((player) => !currentIds.has(player.id));
    players = [...current, ...fallback];
    if (current.length < 100) throw new Error(`current roster only contained ${current.length} supported players`);
    await writeFile(cacheFile, `${JSON.stringify(players, null, 2)}\n`);
  } catch (error) {
    try {
      players = JSON.parse(await readFile(cacheFile, "utf8"));
    } catch {
      throw new Error(`Could not load the ${season} roster and no cache exists: ${error.message}`);
    }
  }

  return buildRosterIndex(players);
}
