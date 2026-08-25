import { createHash } from "node:crypto";

export const SLEEPER_REDRAFT_FORMAT = Object.freeze({
  teams: 12,
  rounds: 13,
  receptionPpr: 1,
  passingTdPoints: 4,
  slots: Object.freeze({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, BENCH: 5, K: 0, DEF: 0 }),
});

const POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export function sleeperPlayerKey(player) {
  const name = String(player?.name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${String(player?.position || "").toLowerCase()}:${name}`;
}

export function normalizeSleeperAdpRows(rows) {
  const byKey = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const position = String(raw?.position || "").toUpperCase();
    const name = String(raw?.name || "").replace(/\s+/g, " ").trim();
    const team = String(raw?.team || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    const rank = Number(raw?.rank);
    const adp = Number(raw?.adp);
    const bye = Number(raw?.bye);
    const sleeperPoints = Number(raw?.sleeperPoints);
    if (!POSITIONS.has(position) || !name || !Number.isFinite(adp) || adp <= 0) continue;
    const player = {
      id: sleeperPlayerKey({ name, position }),
      name,
      team,
      position,
      rank: Number.isFinite(rank) && rank > 0 ? rank : null,
      adp: Number(adp.toFixed(2)),
      bye: Number.isFinite(bye) && bye > 0 ? bye : null,
      sleeperPoints: Number.isFinite(sleeperPoints) && sleeperPoints >= 0 ? Number(sleeperPoints.toFixed(2)) : null,
    };
    const existing = byKey.get(player.id);
    if (!existing || player.adp < existing.adp) byKey.set(player.id, player);
  }
  return [...byKey.values()].sort((left, right) => left.adp - right.adp || left.name.localeCompare(right.name)).slice(0, 250);
}

function sameFormat(format) {
  const slots = format?.slots || {};
  return format?.teams === SLEEPER_REDRAFT_FORMAT.teams
    && format?.rounds === SLEEPER_REDRAFT_FORMAT.rounds
    && format?.receptionPpr === SLEEPER_REDRAFT_FORMAT.receptionPpr
    && format?.passingTdPoints === SLEEPER_REDRAFT_FORMAT.passingTdPoints
    && Object.entries(SLEEPER_REDRAFT_FORMAT.slots).every(([key, value]) => slots[key] === value);
}

export function validateSleeperAdpPair(primary, confirmation) {
  const errors = [];
  if (primary?.source !== "sleeper" || confirmation?.source !== "sleeper") errors.push("source must be sleeper");
  if (!sameFormat(primary?.format) || !sameFormat(confirmation?.format)) errors.push("draft format must be 12-team full PPR, 4-point passing TDs, 13 rounds, no kickers or defenses");
  const first = normalizeSleeperAdpRows(primary?.pages?.[0]?.rows);
  const second = normalizeSleeperAdpRows(confirmation?.pages?.[0]?.rows);
  if (first.length < 150 || second.length < 150) errors.push("at least 150 ranked QB/RB/WR/TE players are required in both passes");
  const secondById = new Map(second.map((player) => [player.id, player]));
  const common = first.filter((player) => secondById.has(player.id));
  if (Math.min(first.length, second.length) && common.length / Math.min(first.length, second.length) < 0.97) errors.push("primary and confirmation player coverage differs by more than 3%");
  const changed = common.filter((player) => Math.abs(player.adp - secondById.get(player.id).adp) > 0.1);
  if (changed.length > 3) errors.push("too many ADP values changed between verification passes");
  return errors;
}

export function verifiedSleeperAdpSnapshot(primary, confirmation, date) {
  const errors = validateSleeperAdpPair(primary, confirmation);
  if (errors.length) throw new Error(errors.join("; "));
  const first = normalizeSleeperAdpRows(primary.pages[0].rows);
  const second = normalizeSleeperAdpRows(confirmation.pages[0].rows);
  const firstById = new Map(first.map((player) => [player.id, player]));
  const players = second.filter((player) => firstById.has(player.id));
  return {
    date,
    capturedAt: confirmation.capturedAt,
    source: "sleeper",
    sourceName: "Sleeper",
    format: SLEEPER_REDRAFT_FORMAT,
    players,
    evidenceHash: createHash("sha256").update(JSON.stringify([primary.pages, confirmation.pages])).digest("hex"),
  };
}

export function buildSleeperAdpPublic(snapshots) {
  const ordered = [...snapshots].filter((snapshot) => Array.isArray(snapshot?.players)).sort((left, right) => left.date.localeCompare(right.date));
  if (!ordered.length) return {
    current: { demo: false, source: "sleeper", format: SLEEPER_REDRAFT_FORMAT, players: [], movements: [] },
    history: {},
  };
  const history = {};
  const movements = [];
  for (const snapshot of ordered) {
    for (const player of snapshot.players) {
      const points = history[player.id] ||= [];
      const previous = points.at(-1);
      const point = { date: snapshot.date, adp: player.adp, rank: player.rank };
      if (previous && previous.adp !== player.adp) {
        movements.push({
          date: snapshot.date,
          player: { id: player.id, name: player.name, team: player.team, position: player.position },
          adp: player.adp,
          adpDelta: Number((player.adp - previous.adp).toFixed(2)),
          changeType: player.adp < previous.adp ? "adp_risen" : "adp_fallen",
        });
      }
      points.push(point);
    }
  }
  const latest = ordered.at(-1);
  return {
    current: { ...latest, demo: false, movements },
    history,
  };
}
