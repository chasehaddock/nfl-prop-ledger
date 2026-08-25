import { requiredFantasyStats, type FantasyPosition, type FantasyStat } from "./fantasy.ts";

type SelectableObservation = {
  source: string;
  statType: FantasyStat;
  line: number;
  status: "open" | "stale" | "not_seen" | "removed";
  capturedAt?: string;
};

export type ConsensusMethod = "single" | "mode" | "average";

export type ConsensusSelection<T> = {
  line: number;
  candidates: T[];
  method: ConsensusMethod;
  supportCount: number;
};

function roundedAverage(values: number[]): number {
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100;
}

export function selectConsensusStats<T extends SelectableObservation>(
  observations: T[],
  statTypes: FantasyStat[],
): Partial<Record<FantasyStat, ConsensusSelection<T>>> {
  const usable = observations.filter((item) => item.status !== "removed" && statTypes.includes(item.statType));

  return Object.fromEntries(statTypes.map((statType) => {
    const candidates = usable.filter((item) => item.statType === statType);
    const current = candidates.filter((item) => item.status === "open");
    const pool = [...(current.length ? current : candidates)].sort((a, b) =>
      a.source.localeCompare(b.source)
      || (Date.parse(b.capturedAt || "") || 0) - (Date.parse(a.capturedAt || "") || 0));
    if (!pool.length) return [statType, undefined];

    const lineGroups = new Map<number, T[]>();
    pool.forEach((item) => lineGroups.set(item.line, [...(lineGroups.get(item.line) || []), item]));
    const maximumSupport = Math.max(...[...lineGroups.values()].map((group) => group.length));
    return [statType, {
      line: pool.length === 1 ? pool[0].line : roundedAverage(pool.map((item) => item.line)),
      candidates: pool,
      method: (pool.length === 1 ? "single" : "average") as ConsensusMethod,
      supportCount: maximumSupport,
    } satisfies ConsensusSelection<T>];
  }).filter((entry): entry is [FantasyStat, ConsensusSelection<T>] => Boolean(entry[1])));
}

export function selectPlayerStats<T extends SelectableObservation>(
  observations: T[],
  position: FantasyPosition,
  statTypes: FantasyStat[] = requiredFantasyStats(position),
): Partial<Record<FantasyStat, T>> {
  const usable = observations.filter((item) => item.status !== "removed" && statTypes.includes(item.statType));
  const coverage = new Map<string, Set<FantasyStat>>();

  usable.filter((item) => item.status === "open").forEach((item) => {
    const stats = coverage.get(item.source) || new Set<FantasyStat>();
    stats.add(item.statType);
    coverage.set(item.source, stats);
  });

  return Object.fromEntries(statTypes.map((statType) => {
    const candidates = usable.filter((item) => item.statType === statType);
    const current = candidates.filter((item) => item.status === "open");
    const selected = [...(current.length ? current : candidates)].sort((a, b) =>
      (coverage.get(b.source)?.size || 0) - (coverage.get(a.source)?.size || 0)
      || b.line - a.line
      || (Date.parse(b.capturedAt || "") || 0) - (Date.parse(a.capturedAt || "") || 0)
      || a.source.localeCompare(b.source))[0];
    return [statType, selected];
  }).filter((entry): entry is [FantasyStat, T] => Boolean(entry[1])));
}
