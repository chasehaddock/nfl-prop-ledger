"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { americanImpliedProbability, calculateFantasyPoints, combineTouchdownProbabilities, fairOverProbability, lineCenteredExpectation, type FantasyLines } from "../src/fantasy";
import { selectConsensusStats, type ConsensusMethod, type ConsensusSelection } from "../src/player-selection";
import { priorSeasonQbRushing } from "../src/prior-season-qb-rushing";
import { priorSeasonRbReceiving, projectEighteenGamePace } from "../src/prior-season-receptions";

type Position = "QB" | "RB" | "WR" | "TE";
type StatType = "passing_yards" | "rushing_yards" | "receiving_yards" | "receptions" | "passing_touchdowns" | "rushing_touchdowns" | "receiving_touchdowns" | "offensive_touchdowns" | "fantasy_score";
type Observation = { key: string; source: string; sourceName?: string; sourceUrl: string; capturedAt?: string; player: { id: string; name: string; team: string; position: Position }; statType: StatType; line: number; lineDelta: number | null; overOdds?: number; underOdds?: number; higherMultiplier?: number; lowerMultiplier?: number; normalizedProbability?: number; status: "open" | "stale" | "not_seen" | "removed"; changeType?: string };
type Snapshot = { demo: boolean; date?: string; season?: number; week?: number; observations: Observation[]; movements?: TrendMove[]; sourceRuns: Array<{ source: string; status: string; observationCount?: number }>; issues?: string[] };
type HistoryPoint = { date: string; line: number; overOdds: number | null; underOdds: number | null; status: string; changeType: string };
type History = Record<string, HistoryPoint[]>;
type ChartPoint = { key: string; label: string; order: number; line: number; reconstructed?: boolean };
type Cell = { key: string; statType: StatType; line: number; delta: number | null; overOdds?: number; underOdds?: number; higherMultiplier?: number; lowerMultiplier?: number; normalizedProbability?: number; sourceUrl: string; source: string; sourceName: string; capturedAt?: string; status: Observation["status"]; fallbackLabel?: string; consensusMethod?: ConsensusMethod; sourceCount?: number; supportCount?: number };
type SourcesByStat = Partial<Record<StatType, Cell[]>>;
type ConfidenceLevel = "strong" | "partial" | "thin";
type PlayerLine = { id: string; player: string; team: string; position: Position; source: string; book: string; availableBooks: string[]; sourcesByStat: SourcesByStat; yardLabel: string; yards: Cell | null; receptions: Cell | null; touchdowns: Cell | null; rushingYards: Cell | null; rushingTouchdowns: Cell | null; receivingYards: Cell | null; receivingTouchdowns: Cell | null; offensiveTouchdowns: Cell | null; passingTouchdownExpectation: number | null; passingTouchdownExpectationLabel: string | null; passingTouchdownExpectationNote: string | null; touchdownProbability: number | null; touchdownProbabilityNote: string | null; fantasyPoints: number | null; fantasyUsesInference: boolean; prizePicksFantasyScore: Cell | null; fantasyBooks: string[]; fantasyUsesReceptionFallback: boolean; fantasyUsesReceivingYardsFallback: boolean; fantasyUsesQbRushingYardsFallback: boolean; fantasyUsesQbRushingTouchdownsFallback: boolean; fantasyAdditionalInferences: string[]; fantasyTdOddsBooks: string[]; confidence: ConfidenceLevel; confidenceNote: string; verifiedAt: string; status: "verified" | "review" };
type TrendRange = "today" | "week" | "all";
type TrendMove = Pick<Observation, "key" | "source" | "sourceUrl" | "player" | "statType" | "line"> & { date: string; lineDelta: number; changeType: "line_increased" | "line_decreased"; sourceName?: string };
type NewProp = Pick<Observation, "key" | "source" | "sourceUrl" | "player" | "statType" | "line"> & { date: string; sourceName: string };
type SortKey = "player" | "book" | "yards" | "secondary" | "touchdowns" | "fantasyPoints" | "prizePicksFantasyScore" | "status";
type SortState = { key: SortKey; direction: "asc" | "desc" };
type BoardMode = "season" | "week1" | "sleeper";
type TePremium = 0 | 0.5 | 1;
type PprScoring = 0 | 0.5 | 1;
type SleeperAdpPlayer = { id: string; name: string; team: string; position: Position; rank: number | null; adp: number; bye: number | null; sleeperPoints: number | null };
type SleeperAdpMove = { date: string; player: { id: string; name: string; team: string; position: Position }; adp: number; adpDelta: number; changeType: "adp_risen" | "adp_fallen" };
type SleeperAdpSnapshot = { demo: boolean; date?: string; capturedAt?: string; source: string; format?: { teams: number; rounds: number; receptionPpr: number; passingTdPoints: number; slots: Record<string, number> }; players: SleeperAdpPlayer[]; movements?: SleeperAdpMove[] };
type SleeperAdpHistory = Record<string, Array<{ date: string; adp: number; rank: number | null }>>;
type SleeperValueRow = SleeperAdpPlayer & { sleeperPositionRank: number; comparableSleeperPositionRank: number | null; projectedPoints: number | null; inferredProjectedPoints: number | null; projectedPositionRank: number | null; valueGap: number | null; missingInputs: string[]; confidence: ConfidenceLevel | null; confidenceNote: string | null };
type SleeperSortKey = "player" | "adp" | "sleeperPositionRank" | "comparableSleeperPositionRank" | "projectedPoints" | "projectedPositionRank" | "valueGap" | "trend";
type SleeperCoverageFilter = "all" | "comparable" | "needs-data";
type ProjectionColumnKey = "yards" | "secondary" | "touchdowns" | "fantasyPoints" | "prizePicksFantasyScore" | "status";
type SleeperColumnKey = Exclude<SleeperSortKey, "player"> | "coverage";
type ColumnChoice = { key: string; label: string };

const SOURCE_NAMES: Record<string, string> = { draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM", prizepicks: "PrizePicks", underdog: "Underdog" };
const STAT_LABELS: Record<StatType, string> = {
  passing_yards: "Pass yards",
  rushing_yards: "Rush yards",
  receiving_yards: "Rec yards",
  receptions: "Receptions",
  passing_touchdowns: "Pass TDs",
  rushing_touchdowns: "Rush TDs",
  receiving_touchdowns: "Rec TDs",
  offensive_touchdowns: "Rush + Rec TDs",
  fantasy_score: "Fantasy score",
};
type PositionFilter = "ALL" | "FLEX" | Position;
const positions: PositionFilter[] = ["ALL", "QB", "RB", "WR", "TE", "FLEX"];
const ALL_STATS: StatType[] = ["passing_yards", "rushing_yards", "receiving_yards", "receptions", "passing_touchdowns", "rushing_touchdowns", "receiving_touchdowns", "offensive_touchdowns", "fantasy_score"];

function matchesPositionFilter(position: Position, filter: PositionFilter) {
  if (filter === "ALL") return true;
  if (filter === "FLEX") return position !== "QB";
  return position === filter;
}

function ColumnChooser({ choices, isVisible, onToggle, onShowAll }: { choices: ColumnChoice[]; isVisible: (key: string) => boolean; onToggle: (key: string) => void; onShowAll: () => void }) {
  const [open, setOpen] = useState(false);
  const visibleCount = choices.filter((choice) => isVisible(choice.key)).length;
  return <div className="column-chooser">
    {open && <section className="column-chooser-panel" role="dialog" aria-label="Choose visible columns">
      <div className="column-chooser-heading"><div><span>Table display</span><strong>Choose columns</strong></div><button onClick={() => setOpen(false)} aria-label="Close column chooser">×</button></div>
      <p>The Player column stays pinned. Turn off anything else to shorten the table.</p>
      <div className="column-choice-list">{choices.map((choice) => {
        const visible = isVisible(choice.key);
        return <button key={choice.key} role="switch" aria-checked={visible} onClick={() => onToggle(choice.key)}><span>{choice.label}</span><i className={visible ? "on" : ""} aria-hidden="true"><b /></i></button>;
      })}</div>
      <button className="show-all-columns" onClick={onShowAll}>Show all columns</button>
    </section>}
    <button className="column-chooser-trigger" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span aria-hidden="true">▥</span><strong>Columns</strong><small>{visibleCount}/{choices.length}</small></button>
  </div>;
}

function demo(player: string, team: string, position: Position, book: string, yards: number, secondary: number, touchdowns: number): PlayerLine {
  const cell = (statType: StatType, line: number): Cell => ({ key: `demo-${player}-${statType}`, statType, line, delta: null, sourceUrl: "#", source: "demo", sourceName: book, status: "open", consensusMethod: "single", sourceCount: 1, supportCount: 1 });
  const yardCell = cell(primaryStat(position), yards);
  const touchdownCell = cell(touchdownStat(position), touchdowns);
  const rushingYards = position === "RB" ? yardCell : position === "QB" ? cell("rushing_yards", 425.5) : null;
  const rushingTouchdowns = position === "RB" ? touchdownCell : position === "QB" ? cell("rushing_touchdowns", secondary) : null;
  const receivingYards = position === "RB" ? cell("receiving_yards", 425.5) : position === "WR" || position === "TE" ? yardCell : null;
  const receivingTouchdowns = position === "RB" ? cell("receiving_touchdowns", 2.5) : position === "WR" || position === "TE" ? touchdownCell : null;
  const receptions = position === "QB" ? null : cell("receptions", secondary);
  const fantasyLines: FantasyLines = position === "QB"
    ? { passing_yards: yards, rushing_yards: rushingYards?.line, rushing_touchdowns: secondary, passing_touchdowns: touchdowns }
    : position === "RB"
      ? { rushing_yards: yards, receptions: secondary, rushing_touchdowns: touchdowns, receiving_yards: receivingYards?.line, receiving_touchdowns: receivingTouchdowns?.line }
      : { receiving_yards: yards, receptions: secondary, receiving_touchdowns: touchdowns };
  const cells = [yardCell, receptions, touchdownCell, rushingYards, rushingTouchdowns, receivingYards, receivingTouchdowns].filter((item): item is Cell => Boolean(item));
  const sourcesByStat = Object.fromEntries(cells.map((item) => [item.statType, [item]])) as SourcesByStat;
  return { id: `demo-${player}`, player, team, position, source: "demo", book, availableBooks: [book], sourcesByStat, yardLabel: position === "QB" ? "Pass yds" : position === "RB" ? "Rush yds" : "Rec yds", yards: yardCell, receptions, touchdowns: touchdownCell, rushingYards, rushingTouchdowns, receivingYards, receivingTouchdowns, offensiveTouchdowns: null, passingTouchdownExpectation: null, passingTouchdownExpectationLabel: null, passingTouchdownExpectationNote: null, touchdownProbability: null, touchdownProbabilityNote: null, fantasyPoints: calculateFantasyPoints(position, fantasyLines), fantasyUsesInference: false, prizePicksFantasyScore: null, fantasyBooks: [book], fantasyUsesReceptionFallback: false, fantasyUsesReceivingYardsFallback: false, fantasyUsesQbRushingYardsFallback: false, fantasyUsesQbRushingTouchdownsFallback: false, fantasyAdditionalInferences: [], fantasyTdOddsBooks: [], confidence: "thin", confidenceNote: "Preview source only", verifiedAt: "Preview only", status: "review" };
}

function confidenceFor(sourceCount: number, complete: boolean, inferredCount: number): { level: ConfidenceLevel; note: string } {
  const sourceLabel = `${sourceCount} source${sourceCount === 1 ? "" : "s"}`;
  if (complete && sourceCount >= 3 && inferredCount === 0) return { level: "strong", note: `${sourceLabel} · complete inputs` };
  if (sourceCount >= 2 && (complete || inferredCount === 0)) return { level: "partial", note: `${sourceLabel} · ${complete ? inferredCount ? `${inferredCount} inferred input${inferredCount === 1 ? "" : "s"}` : "complete inputs" : "missing fantasy input"}` };
  return { level: "thin", note: `${sourceLabel} · ${complete ? inferredCount ? `${inferredCount} inferred input${inferredCount === 1 ? "" : "s"}` : "single-source projection" : "missing fantasy input"}` };
}

const DEMO_LINES: PlayerLine[] = [
  demo("Joe Burrow", "CIN", "QB", "DraftKings", 4275.5, 2.5, 31.5),
  demo("Saquon Barkley", "PHI", "RB", "DraftKings", 1225.5, 46.5, 11.5),
  demo("Ja'Marr Chase", "CIN", "WR", "DraftKings", 1375.5, 101.5, 10.5),
  demo("Brock Bowers", "LV", "TE", "DraftKings", 1025.5, 91.5, 6.5),
];

function primaryStat(position: Position): StatType {
  if (position === "QB") return "passing_yards";
  if (position === "RB") return "rushing_yards";
  return "receiving_yards";
}

function touchdownStat(position: Position): StatType {
  if (position === "QB") return "passing_touchdowns";
  if (position === "RB") return "rushing_touchdowns";
  return "receiving_touchdowns";
}

function asCell(observation: Observation | undefined): Cell | null {
  if (!observation) return null;
  return { key: observation.key, statType: observation.statType, line: observation.line, delta: observation.lineDelta, overOdds: observation.overOdds, underOdds: observation.underOdds, higherMultiplier: observation.higherMultiplier, lowerMultiplier: observation.lowerMultiplier, normalizedProbability: observation.normalizedProbability, sourceUrl: observation.sourceUrl, source: observation.source, sourceName: observation.sourceName || SOURCE_NAMES[observation.source] || observation.source, capturedAt: observation.capturedAt, status: observation.status };
}

function consensusCell(playerId: string, statType: StatType, selection: ConsensusSelection<Observation> | undefined): Cell | null {
  if (!selection) return null;
  const only = selection.candidates.length === 1 ? selection.candidates[0] : null;
  return {
    key: only?.key || `consensus:${playerId}:${statType}`,
    statType,
    line: selection.line,
    delta: only?.lineDelta ?? null,
    overOdds: only?.overOdds,
    underOdds: only?.underOdds,
    higherMultiplier: only?.higherMultiplier,
    lowerMultiplier: only?.lowerMultiplier,
    normalizedProbability: only?.normalizedProbability,
    sourceUrl: only?.sourceUrl || selection.candidates[0].sourceUrl,
    source: only?.source || "consensus",
    sourceName: only ? only.sourceName || SOURCE_NAMES[only.source] || only.source : "Consensus",
    capturedAt: selection.candidates.map((item) => item.capturedAt).filter(Boolean).sort().at(-1),
    status: selection.candidates.every((item) => item.status === "open") ? "open" : "stale",
    consensusMethod: selection.method,
    sourceCount: selection.candidates.length,
    supportCount: selection.supportCount,
  };
}

function priorSeasonReceptionCell(playerId: string): Cell | null {
  const prior = priorSeasonRbReceiving(playerId);
  if (!prior) return null;
  const line = projectEighteenGamePace(prior.receptions, prior.gamesPlayed);
  return { key: `prior:${prior.season}:${playerId}:receptions`, statType: "receptions", line, delta: null, sourceUrl: prior.sourceUrl, source: "prior-season", sourceName: `${prior.season} NFL pace`, status: "open", fallbackLabel: "based on last year" };
}

function priorSeasonReceivingYardsCell(playerId: string): Cell | null {
  const prior = priorSeasonRbReceiving(playerId);
  if (!prior) return null;
  const line = projectEighteenGamePace(prior.receivingYards, prior.gamesPlayed);
  return { key: `prior:${prior.season}:${playerId}:receiving_yards`, statType: "receiving_yards", line, delta: null, sourceUrl: prior.sourceUrl, source: "prior-season", sourceName: `${prior.season} NFL pace`, status: "open", fallbackLabel: "based on last year" };
}

function priorSeasonQbRushingCell(playerId: string, statType: "rushing_yards" | "rushing_touchdowns"): Cell | null {
  const prior = priorSeasonQbRushing(playerId);
  if (!prior) return null;
  const total = statType === "rushing_yards" ? prior.rushingYards : prior.rushingTouchdowns;
  const line = projectEighteenGamePace(total, prior.gamesPlayed);
  if (line <= 0) return null;
  return { key: `prior:${prior.season}:${playerId}:${statType}`, statType, line, delta: null, sourceUrl: prior.sourceUrl, source: "prior-season", sourceName: `${prior.season} NFL pace`, status: "open", fallbackLabel: "based on last year" };
}

function blendedQbRushingYardsCell(playerId: string, weeklySelection: ConsensusSelection<Observation> | undefined): Cell | null {
  const prior = priorSeasonQbRushing(playerId);
  const weeklyIsCurrent = weeklySelection?.candidates.some((item) => item.status === "open");
  const weeklyRate = weeklyIsCurrent ? weeklySelection!.line : null;
  const priorRate = prior && prior.rushingYards > 0 ? Number((prior.rushingYards / prior.gamesPlayed).toFixed(1)) : null;
  if (weeklyRate === null && priorRate === null) return null;

  const weeklySeason = weeklyRate === null ? null : projectEighteenGamePace(weeklyRate, 1);
  const priorSeason = priorRate === null ? null : projectEighteenGamePace(prior!.rushingYards, prior!.gamesPlayed);
  const line = weeklySeason !== null && priorSeason !== null
    ? Number(((weeklySeason + priorSeason) / 2).toFixed(1))
    : weeklySeason ?? priorSeason!;
  if (line <= 0) return null;
  const method = weeklySeason !== null && priorSeason !== null ? "last year + Week 1" : weeklySeason !== null ? "Week 1 projection" : "last year";
  return {
    key: `inferred-season:${playerId}:rushing_yards`,
    statType: "rushing_yards",
    line,
    delta: null,
    sourceUrl: weeklySelection?.candidates[0]?.sourceUrl || prior?.sourceUrl || "#",
    source: "season-inference",
    sourceName: `Estimate · ${method}`,
    status: "open",
    fallbackLabel: `based on ${method}`,
  };
}

type TouchdownProjection = { probability: number; books: string[]; pricing: "normalized-multiplier" | "de-vigged" | "one-sided" | "mixed" };
type PassingTouchdownExpectation = { value: number; books: string[]; label: string; note: string };

function normalizedMultiplierProbability(higherMultiplier: number, lowerMultiplier: number): number {
  if (!Number.isFinite(higherMultiplier) || higherMultiplier <= 0 || !Number.isFinite(lowerMultiplier) || lowerMultiplier <= 0) return Number.NaN;
  const higherWeight = 1 / higherMultiplier;
  const lowerWeight = 1 / lowerMultiplier;
  return higherWeight / (higherWeight + lowerWeight);
}

function weeklyPassingTouchdownExpectation(selection: ConsensusSelection<Observation> | undefined): PassingTouchdownExpectation | null {
  const multiplierPriced = (selection?.candidates || []).filter((item) => item.status === "open"
    && item.source === "underdog"
    && Number.isFinite(item.line)
    && Number.isFinite(item.higherMultiplier)
    && Number.isFinite(item.lowerMultiplier));
  if (multiplierPriced.length) {
    const estimates = multiplierPriced.map((item) => ({
      item,
      expected: lineCenteredExpectation(item.line, normalizedMultiplierProbability(item.higherMultiplier!, item.lowerMultiplier!)),
    })).filter(({ expected }) => Number.isFinite(expected));
    if (!estimates.length) return null;
    const value = Number((estimates.reduce((total, estimate) => total + estimate.expected, 0) / estimates.length).toFixed(2));
    const books = ["Underdog"];
    const details = estimates.map(({ item, expected }) => `Underdog H ${item.line} ${item.higherMultiplier!.toFixed(2)}x / L ${item.line} ${item.lowerMultiplier!.toFixed(2)}x → ${expected.toFixed(2)}`).join(" · ");
    return { value, books, label: "Underdog normalized", note: `${value.toFixed(2)} expected pass TDs · normalized Higher/Lower modifiers + line-centered adjustment · ${details}` };
  }
  const allPriced = (selection?.candidates || []).filter((item) => item.status === "open"
    && item.source !== "prizepicks"
    && Number.isFinite(item.line)
    && Number.isFinite(item.overOdds)
    && Number.isFinite(item.underOdds));
  const fanDuel = allPriced.filter((item) => item.source === "fanduel");
  const priced = fanDuel.length ? fanDuel : allPriced;
  const estimates = priced.map((item) => ({
    item,
    fairOver: fairOverProbability(item.overOdds!, item.underOdds!),
  })).map(({ item, fairOver }) => ({ item, expected: lineCenteredExpectation(item.line, fairOver) }))
    .filter(({ expected }) => Number.isFinite(expected));
  if (!estimates.length) return null;
  const value = Number((estimates.reduce((total, estimate) => total + estimate.expected, 0) / estimates.length).toFixed(2));
  const books = [...new Set(estimates.map(({ item }) => item.sourceName || SOURCE_NAMES[item.source] || item.source))].sort();
  const details = estimates.map(({ item, expected }) => {
    const sourceName = item.sourceName || SOURCE_NAMES[item.source] || item.source;
    const overOdds = item.overOdds! > 0 ? `+${item.overOdds}` : `${item.overOdds}`;
    const underOdds = item.underOdds! > 0 ? `+${item.underOdds}` : `${item.underOdds}`;
    return `${sourceName} O ${item.line} ${overOdds} / U ${item.line} ${underOdds} → ${expected.toFixed(2)}`;
  }).join(" · ");
  return { value, books, label: "sportsbook no-vig", note: `${value.toFixed(2)} expected pass TDs · vig removed + line-centered adjustment · ${details}` };
}

function weeklyTouchdownProjection(selection: ConsensusSelection<Observation> | undefined): TouchdownProjection | null {
  const multiplierPriced = (selection?.candidates || []).filter((item) => item.status === "open"
    && item.source === "underdog"
    && item.line === 0.5
    && Number.isFinite(item.higherMultiplier)
    && Number.isFinite(item.lowerMultiplier));
  if (multiplierPriced.length) {
    const probabilities = multiplierPriced
      .map((item) => normalizedMultiplierProbability(item.higherMultiplier!, item.lowerMultiplier!))
      .filter((probability) => Number.isFinite(probability));
    if (!probabilities.length) return null;
    return {
      probability: probabilities.reduce((total, probability) => total + probability, 0) / probabilities.length,
      books: ["Underdog"],
      pricing: "normalized-multiplier",
    };
  }
  const priced = (selection?.candidates || []).filter((item) => item.status === "open"
    && item.line === 0.5
    && Number.isFinite(item.overOdds));
  if (!priced.length) return null;
  const twoSidedCount = priced.filter((item) => Number.isFinite(item.underOdds)).length;
  return {
    probability: priced.reduce((total, item) => total + (Number.isFinite(item.underOdds)
      ? fairOverProbability(item.overOdds!, item.underOdds!)
      : americanImpliedProbability(item.overOdds!)), 0) / priced.length,
    books: [...new Set(priced.map((item) => item.sourceName || SOURCE_NAMES[item.source] || item.source))].sort(),
    pricing: twoSidedCount === priced.length ? "de-vigged" : twoSidedCount === 0 ? "one-sided" : "mixed",
  };
}

function oddsMethodLabel(...projections: TouchdownProjection[]): string {
  if (projections.every((projection) => projection.pricing === "normalized-multiplier")) return "Underdog Higher/Lower normalized";
  if (projections.every((projection) => projection.pricing === "de-vigged")) return "vig removed";
  if (projections.every((projection) => projection.pricing === "one-sided")) return "one-sided price includes vig";
  return "includes one-sided price with vig";
}

function standardPrizePicksAnyTouchdown(selection: ConsensusSelection<Observation> | undefined): { probability: number; books: string[] } | null {
  const standard = (selection?.candidates || []).filter((item) => item.status === "open" && item.source === "prizepicks" && item.line === 0.5);
  return standard.length ? { probability: 0.5, books: ["PrizePicks"] } : null;
}

function weeklyTouchdownProbability(byStat: Partial<Record<StatType, ConsensusSelection<Observation> | undefined>>): { probability: number; books: string[]; note: string } | null {
  const anyTouchdown = weeklyTouchdownProjection(byStat.offensive_touchdowns);
  if (anyTouchdown) return { probability: anyTouchdown.probability, books: anyTouchdown.books, note: `Any-TD odds · ${oddsMethodLabel(anyTouchdown)} · ${anyTouchdown.books.join(" + ")}` };
  const rushing = weeklyTouchdownProjection(byStat.rushing_touchdowns);
  const receiving = weeklyTouchdownProjection(byStat.receiving_touchdowns);
  if (rushing && receiving) {
    const books = [...new Set([...rushing.books, ...receiving.books])].sort();
    return { probability: combineTouchdownProbabilities(rushing.probability, receiving.probability), books, note: `Estimated from rush + rec TD odds · ${oddsMethodLabel(rushing, receiving)} · ${books.join(" + ")}` };
  }
  const oneMarket = rushing || receiving;
  if (oneMarket) return { probability: oneMarket.probability, books: oneMarket.books, note: `${rushing ? "Rushing" : "Receiving"} TD odds · ${oddsMethodLabel(oneMarket)} · ${oneMarket.books.join(" + ")}` };
  const prizePicks = standardPrizePicksAnyTouchdown(byStat.offensive_touchdowns);
  return prizePicks ? { ...prizePicks, note: "PrizePicks standard 0.5 any-TD line" } : null;
}

function inferredTouchdownCell(
  playerId: string,
  statType: "rushing_touchdowns" | "receiving_touchdowns",
  totalSelection: ConsensusSelection<Observation> | undefined,
  knownSelection: ConsensusSelection<Observation> | undefined,
): Cell | null {
  for (const total of totalSelection?.candidates || []) {
    if (total.status !== "open") continue;
    const known = knownSelection?.candidates.find((candidate) => candidate.status === "open" && candidate.source === total.source);
    if (!known || known.line > total.line) continue;
    const line = Number((total.line - known.line).toFixed(2));
    // A zero component is not useful to display and must never become an
    // orange "inferred" TD note. The sportsbook total remains the displayed
    // projection while the unavailable split stays blank.
    if (line <= 0) continue;
    const sourceName = total.sourceName || SOURCE_NAMES[total.source] || total.source;
    return {
      key: `inferred:${playerId}:${statType}:${total.source}`,
      statType,
      line,
      delta: null,
      sourceUrl: total.sourceUrl,
      source: total.source,
      sourceName,
      capturedAt: [total.capturedAt, known.capturedAt].filter(Boolean).sort().at(-1),
      status: "open",
      fallbackLabel: `based on ${sourceName} total TD line`,
    };
  }
  return null;
}

function aggregate(snapshot: Snapshot, weeklyContext?: Snapshot): PlayerLine[] {
  const groups = new Map<string, Observation[]>();
  const weeklyGroups = new Map<string, Observation[]>();
  snapshot.observations.filter((item) => item.status !== "removed").forEach((item) => {
    const key = item.player.id;
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  weeklyContext?.observations.filter((item) => item.status !== "removed").forEach((item) => {
    const key = item.player.id;
    weeklyGroups.set(key, [...(weeklyGroups.get(key) || []), item]);
  });
  const lines: PlayerLine[] = [];
  for (const [playerId, observations] of groups) {
    const first = observations[0];
    const yardStat = primaryStat(first.player.position);
    const byStat = selectConsensusStats(observations, ALL_STATS);
    const currentCell = (statType: StatType) => byStat[statType]?.candidates.some((item) => item.status === "open")
      ? consensusCell(playerId, statType, byStat[statType])
      : null;
    const allowSeasonInference = snapshot.week !== 1;
    const marketYards = currentCell(yardStat);
    const yards = marketYards;
    const marketReceptions = currentCell("receptions");
    const receptionFallback = allowSeasonInference && first.player.position === "RB" && !marketReceptions ? priorSeasonReceptionCell(playerId) : null;
    const receptions = first.player.position === "QB" ? null : marketReceptions;
    const marketRushingYards = currentCell("rushing_yards");
    const weeklyRushingYards = weeklyGroups.has(playerId) ? selectConsensusStats(weeklyGroups.get(playerId)!, ["rushing_yards"]).rushing_yards : undefined;
    const qbRushingYardsFallback = first.player.position === "QB" && allowSeasonInference && !marketRushingYards ? blendedQbRushingYardsCell(playerId, weeklyRushingYards) : null;
    const rushingYards = marketRushingYards || qbRushingYardsFallback;
    const marketReceivingYards = currentCell("receiving_yards");
    const receivingYardsFallback = allowSeasonInference && first.player.position === "RB" && !marketReceivingYards ? priorSeasonReceivingYardsCell(playerId) : null;
    const receivingYards = marketReceivingYards || receivingYardsFallback;
    const offensiveTouchdowns = currentCell("offensive_touchdowns");
    const marketRushingTouchdowns = currentCell("rushing_touchdowns");
    const qbRushingTouchdownsFallback = first.player.position === "QB" && allowSeasonInference && !marketRushingTouchdowns ? priorSeasonQbRushingCell(playerId, "rushing_touchdowns") : null;
    const marketReceivingTouchdowns = currentCell("receiving_touchdowns");
    const canInferComponents = ["RB", "WR", "TE"].includes(first.player.position);
    const rushingTouchdowns = marketRushingTouchdowns
      ? marketRushingTouchdowns
      : canInferComponents
        ? inferredTouchdownCell(playerId, "rushing_touchdowns", byStat.offensive_touchdowns, byStat.receiving_touchdowns)
        : qbRushingTouchdownsFallback;
    const receivingTouchdowns = marketReceivingTouchdowns
      ? marketReceivingTouchdowns
      : canInferComponents
        ? inferredTouchdownCell(playerId, "receiving_touchdowns", byStat.offensive_touchdowns, byStat.rushing_touchdowns)
        : null;
    const marketPassingTouchdowns = currentCell("passing_touchdowns");
    const passingTouchdownExpectation = first.player.position === "QB" && snapshot.week === 1
      ? weeklyPassingTouchdownExpectation(byStat.passing_touchdowns)
      : null;
    const touchdowns = first.player.position === "QB"
      ? marketPassingTouchdowns
      : first.player.position === "RB"
        ? rushingTouchdowns
        : receivingTouchdowns;
    const prizePicksFantasyScore = currentCell("fantasy_score");
    const shownReceptions = receptions || receptionFallback;
    const selected = [yards, shownReceptions, touchdowns, rushingYards, rushingTouchdowns, receivingYards, receivingTouchdowns, offensiveTouchdowns].filter((item): item is Cell => Boolean(item));
    const touchdownProbability = snapshot.week === 1 ? weeklyTouchdownProbability(byStat) : null;
    const fantasyLines: FantasyLines = {};
    if (yards) fantasyLines[yardStat] = yards.line;
    if (shownReceptions) fantasyLines.receptions = shownReceptions.line;
    if (rushingYards) fantasyLines.rushing_yards = rushingYards.line;
    if (receivingYards) fantasyLines.receiving_yards = receivingYards.line;
    if (first.player.position === "QB" && (passingTouchdownExpectation || touchdowns)) {
      fantasyLines.passing_touchdowns = passingTouchdownExpectation?.value ?? touchdowns!.line;
    }
    if (rushingTouchdowns) fantasyLines.rushing_touchdowns = rushingTouchdowns.line;
    if (receivingTouchdowns) fantasyLines.receiving_touchdowns = receivingTouchdowns.line;
    if (offensiveTouchdowns) fantasyLines.offensive_touchdowns = offensiveTouchdowns.line;
    if (touchdownProbability) fantasyLines.offensive_touchdowns = touchdownProbability.probability;
    const fantasyPoints = calculateFantasyPoints(first.player.position, fantasyLines);
    const complete = fantasyPoints !== null;
    const latest = Object.values(byStat).flatMap((selection) => selection?.candidates || []).map((item) => item.capturedAt).filter(Boolean).sort().at(-1);
    const sourcesByStat = Object.fromEntries(Object.entries(byStat).map(([statType, selection]) => [statType, (selection?.candidates || []).map((item) => asCell(item)!).sort((a, b) => a.sourceName.localeCompare(b.sourceName))])) as SourcesByStat;
    const availableBooks = [...new Set(Object.values(sourcesByStat).flatMap((cells) => cells || []).map((item) => item.sourceName))].sort();
    const onlySource = Object.values(sourcesByStat).flatMap((cells) => cells || [])[0]?.source;
    const inferredCells = [...new Map(selected.filter((cell) => cell.fallbackLabel).map((cell) => [cell.key, cell])).values()];
    const inferredCount = inferredCells.length;
    const fantasyUsesInference = fantasyPoints !== null && inferredCount > 0;
    const separatelyLabeledFallbacks = new Set([receptionFallback?.key, receivingYardsFallback?.key, qbRushingYardsFallback?.key, qbRushingTouchdownsFallback?.key].filter(Boolean));
    const fantasyAdditionalInferences = [...new Set(inferredCells.filter((cell) => !separatelyLabeledFallbacks.has(cell.key)).map((cell) => STAT_LABELS[cell.statType]))];
    const confidence = confidenceFor(availableBooks.length, complete && !fantasyUsesInference, inferredCount);
    lines.push({
      id: playerId,
      player: first.player.name,
      team: first.player.team,
      position: first.player.position,
      source: availableBooks.length === 1 ? onlySource || "consensus" : "consensus",
      book: availableBooks.length === 1 ? availableBooks[0] : "Consensus",
      availableBooks,
      sourcesByStat,
      yardLabel: first.player.position === "QB" ? "Pass yds" : first.player.position === "RB" ? "Rush yds" : "Rec yds",
      yards,
      receptions: shownReceptions,
      touchdowns,
      rushingYards,
      rushingTouchdowns,
      receivingYards,
      receivingTouchdowns,
      offensiveTouchdowns,
      passingTouchdownExpectation: passingTouchdownExpectation?.value ?? null,
      passingTouchdownExpectationLabel: passingTouchdownExpectation?.label ?? null,
      passingTouchdownExpectationNote: passingTouchdownExpectation?.note ?? null,
      touchdownProbability: touchdownProbability?.probability ?? null,
      touchdownProbabilityNote: touchdownProbability?.note ?? null,
      fantasyPoints,
      fantasyUsesInference,
      prizePicksFantasyScore,
      fantasyBooks: availableBooks,
      fantasyUsesReceptionFallback: Boolean(receptionFallback && !marketReceptions),
      fantasyUsesReceivingYardsFallback: Boolean(receivingYardsFallback && !marketReceivingYards),
      fantasyUsesQbRushingYardsFallback: Boolean(qbRushingYardsFallback && !marketRushingYards),
      fantasyUsesQbRushingTouchdownsFallback: Boolean(qbRushingTouchdownsFallback && !marketRushingTouchdowns),
      fantasyAdditionalInferences,
      fantasyTdOddsBooks: touchdownProbability?.books || [],
      confidence: confidence.level,
      confidenceNote: confidence.note,
      verifiedAt: latest ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Denver" }).format(new Date(latest as string)) + " MT" : snapshot.date || "—",
      status: selected.every((item) => item.status === "open") ? "verified" : "review",
    });
  }
  return lines;
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="delta muted">New</span>;
  if (value === 0) return <span className="delta muted">—</span>;
  return <span className={`delta ${value > 0 ? "up" : "down"}`}>{value > 0 ? "+" : ""}{value}</span>;
}

function consensusDescription(cell: Cell): string {
  if (cell.sourceCount === 1) return "1 source";
  if (cell.consensusMethod === "mode") return `${cell.sourceCount} sources · most common`;
  if (cell.consensusMethod === "average") return `${cell.sourceCount} sources · arithmetic average`;
  return `${cell.sourceCount || 1} sources`;
}

function LineCell({ cell, label, preferredSource, player, onInspect }: { cell: Cell | null; label?: string; preferredSource: string; player?: string; onInspect?: (statType: StatType) => void }) {
  if (!cell) return <span className="empty">Not offered</span>;
  if (cell.fallbackLabel) {
    const estimateLabel = (label || STAT_LABELS[cell.statType]).toLowerCase();
    return <><span className="empty">Not offered</span><small className="historical-fallback">Estimated {cell.line.toLocaleString()} {estimateLabel} · {cell.fallbackLabel}</small></>;
  }
  const content = <><div className="number-cell"><strong>{cell.line.toLocaleString()}</strong>{!cell.fallbackLabel && cell.sourceCount === 1 && <Delta value={cell.delta} />}{!cell.fallbackLabel && (cell.sourceCount || 0) > 1 && <span className="consensus-badge">{cell.consensusMethod === "average" ? "AVG" : "MODE"}</span>}</div>{label && <small>{label}</small>}{cell.overOdds && cell.underOdds && <small>O {cell.overOdds > 0 ? "+" : ""}{cell.overOdds} / U {cell.underOdds > 0 ? "+" : ""}{cell.underOdds}</small>}{cell.fallbackLabel ? <small className="historical-fallback">{cell.fallbackLabel}</small> : (cell.sourceCount || 0) > 1 ? <small className="consensus-note">{consensusDescription(cell)} · click to compare</small> : cell.source !== preferredSource && <small className="fallback-source">Filled from {cell.sourceName}</small>}</>;
  if (!onInspect || cell.fallbackLabel) return content;
  return <button className="prop-trigger" onClick={() => onInspect(cell.statType)} aria-label={`Compare ${player || "player"} ${STAT_LABELS[cell.statType]} across sources`}>{content}</button>;
}

function StatStack({ entries, preferredSource, player, onInspect }: { entries: Array<{ cell: Cell | null; label: string }>; preferredSource: string; player?: string; onInspect?: (statType: StatType) => void }) {
  const visible = [...new Map(entries.filter((entry) => entry.cell).map((entry) => [entry.cell!.key, entry])).values()];
  if (!visible.length) return <span className="empty">Not offered</span>;
  return <div className="stat-stack">{visible.map((entry) => <div className="stat-entry" key={entry.cell!.key}><LineCell cell={entry.cell} label={entry.label} preferredSource={preferredSource} player={player} onInspect={onInspect} /></div>)}</div>;
}

function skillTouchdownTotal(line: PlayerLine): number | null {
  if (line.position === "QB") return null;
  if (line.offensiveTouchdowns) return line.offensiveTouchdowns.line;
  if (!line.rushingTouchdowns && !line.receivingTouchdowns) return null;
  return Number(((line.rushingTouchdowns?.line || 0) + (line.receivingTouchdowns?.line || 0)).toFixed(2));
}

function touchdownBreakdownValue(cell: Cell | null): string {
  return cell && !cell.fallbackLabel ? cell.line.toLocaleString() : "—";
}

function SeasonTouchdownCell({ line, onInspect }: { line: PlayerLine; onInspect: (statType: StatType) => void }) {
  if (line.position === "QB") {
    return <StatStack entries={[{ cell: line.touchdowns, label: "Pass TD" }, { cell: line.rushingTouchdowns, label: "Rush TD" }]} preferredSource={line.source} player={line.player} onInspect={onInspect} />;
  }

  const total = skillTouchdownTotal(line);
  if (total === null) return <span className="empty">Not offered</span>;
  const inferredCells = [line.rushingTouchdowns, line.receivingTouchdowns]
    .filter((cell): cell is Cell => Boolean(cell?.fallbackLabel));

  return <div className="total-touchdowns">
    {line.offensiveTouchdowns
      ? <LineCell cell={line.offensiveTouchdowns} label="Total TDs" preferredSource={line.source} player={line.player} onInspect={onInspect} />
      : <><div className="number-cell"><strong>{total.toLocaleString()}</strong></div><small>Total TDs · calculated</small></>}
    <small className="td-breakdown">Rush {touchdownBreakdownValue(line.rushingTouchdowns)} · Rec {touchdownBreakdownValue(line.receivingTouchdowns)}</small>
    {inferredCells.map((cell) => <small className="td-inference" key={cell.key}>Estimated {cell.line.toLocaleString()} {STAT_LABELS[cell.statType]} · {cell.fallbackLabel}</small>)}
  </div>;
}

function TrendCard({ moves, isDemo, waitingForWeekly, range, onRange, onSelect }: { moves: TrendMove[]; isDemo: boolean; waitingForWeekly: boolean; range: TrendRange; onRange: (range: TrendRange) => void; onSelect: (move: TrendMove) => void }) {
  const rises = moves.filter((move) => move.lineDelta > 0).length;
  const falls = moves.filter((move) => move.lineDelta < 0).length;
  return <section className="trend-card" aria-labelledby="trend-title">
    <div className="trend-heading"><div><p className="eyebrow">Market pulse</p><h2 id="trend-title">Line movement</h2></div><span className="trend-live"><i aria-hidden="true" />Verified</span></div>
    <div className="trend-range" role="group" aria-label="Line movement time range">{(["today", "week", "all"] as TrendRange[]).map((item) => <button key={item} className={range === item ? "active" : ""} aria-pressed={range === item} onClick={() => onRange(item)}>{item === "all" ? "All history" : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    <div className="trend-counts" aria-label={`${rises} rising lines and ${falls} falling lines`}><span className="trend-up">↑ {rises} up</span><span className="trend-down">↓ {falls} down</span></div>
    {moves.length ? <ol className="trend-list">{moves.map((move) => {
      const up = move.lineDelta > 0;
      return <li key={`${move.date}:${move.key}`}><button onClick={() => onSelect(move)} aria-label={`Show ${move.player.name}, ${STAT_LABELS[move.statType]}, ${up ? "up" : "down"} ${Math.abs(move.lineDelta)}`}><span className={`trend-arrow ${up ? "trend-up" : "trend-down"}`} aria-hidden="true">{up ? "↑" : "↓"}</span><span className="trend-player"><strong>{move.player.name}</strong><small>{move.player.position} · {STAT_LABELS[move.statType]} · {move.sourceName || SOURCE_NAMES[move.source] || move.source}{range !== "today" ? ` · ${move.date.slice(5)}` : ""}</small></span><span className="trend-value"><strong>{move.line.toLocaleString()}</strong><small className={up ? "trend-up" : "trend-down"}>{up ? "+" : ""}{move.lineDelta}</small></span></button></li>;
    })}</ol> : <p className="trend-empty">{waitingForWeekly ? "Week 1 movements will appear after the first two verified weekly captures." : isDemo ? "Verified daily moves will appear after the first two captures." : `No verified line moves in this ${range === "all" ? "history" : range} view.`}</p>}
  </section>;
}

function newPropsInRange(snapshot: Snapshot, history: History, range: TrendRange): NewProp[] {
  const observations = new Map(snapshot.observations.map((observation) => [observation.key, observation]));
  const openings: NewProp[] = [];
  Object.entries(history).forEach(([key, points]) => {
    const observation = observations.get(key);
    if (!observation) return;
    points.filter((point) => point.changeType === "opened").forEach((point) => openings.push({
      key,
      source: observation.source,
      sourceName: observation.sourceName || SOURCE_NAMES[observation.source] || observation.source,
      sourceUrl: observation.sourceUrl,
      player: observation.player,
      statType: observation.statType,
      line: point.line,
      date: point.date,
    }));
  });
  const knownKeys = new Set(openings.map((opening) => `${opening.date}:${opening.key}`));
  snapshot.observations.filter((observation) => observation.changeType === "opened").forEach((observation) => {
    const date = snapshot.date || observation.capturedAt?.slice(0, 10) || "";
    if (!knownKeys.has(`${date}:${observation.key}`)) openings.push({
      key: observation.key,
      source: observation.source,
      sourceName: observation.sourceName || SOURCE_NAMES[observation.source] || observation.source,
      sourceUrl: observation.sourceUrl,
      player: observation.player,
      statType: observation.statType,
      line: observation.line,
      date,
    });
  });
  const baselineDate = openings.map((opening) => opening.date).filter(Boolean).sort()[0];
  const currentDate = snapshot.date || "";
  const weekStart = currentDate ? new Date(Date.parse(`${currentDate}T12:00:00Z`) - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
  return openings
    .filter((opening) => opening.date !== baselineDate)
    .filter((opening) => range === "all" || (range === "today" ? opening.date === currentDate : opening.date >= weekStart && opening.date <= currentDate))
    .sort((left, right) => right.date.localeCompare(left.date) || left.player.name.localeCompare(right.player.name) || left.sourceName.localeCompare(right.sourceName));
}

function NewPropsCard({ props: newProps, range, onRange, onSelect }: { props: NewProp[]; range: TrendRange; onRange: (range: TrendRange) => void; onSelect: (prop: NewProp) => void }) {
  return <section className="trend-card new-props-card" aria-labelledby="new-props-title">
    <div className="trend-heading"><div><p className="eyebrow">Fresh markets</p><h2 id="new-props-title">New props</h2></div><span className="trend-live"><i aria-hidden="true" />Opened</span></div>
    <div className="trend-range" role="group" aria-label="New props time range">{(["today", "week", "all"] as TrendRange[]).map((item) => <button key={item} className={range === item ? "active" : ""} aria-pressed={range === item} onClick={() => onRange(item)}>{item === "all" ? "All history" : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    <div className="new-props-count"><strong>{newProps.length}</strong><span>new prop{newProps.length === 1 ? "" : "s"} added</span></div>
    {newProps.length ? <ol className="new-props-list">{newProps.map((prop) => <li key={`${prop.date}:${prop.key}`}><button onClick={() => onSelect(prop)} aria-label={`Open new ${STAT_LABELS[prop.statType]} prop for ${prop.player.name} from ${prop.sourceName}`}><span className={`new-prop-source source-${prop.source}`} aria-hidden="true" /><span className="trend-player"><strong>{prop.player.name}</strong><small>{prop.player.position} · {STAT_LABELS[prop.statType]} · {prop.sourceName}{range !== "today" ? ` · ${prop.date.slice(5)}` : ""}</small></span><span className="trend-value"><strong>{prop.line.toLocaleString()}</strong><small>new</small></span></button></li>)}</ol> : <p className="trend-empty">No newly opened props in this view. The original first-day board is treated as the baseline.</p>}
  </section>;
}

function displayedFantasyPoints(line: PlayerLine, qbPassTdPoints: 4 | 6, tePremium: TePremium, pprScoring: PprScoring): number | null {
  if (line.fantasyPoints === null) return null;
  let points = line.fantasyPoints;
  const passingTouchdowns = line.passingTouchdownExpectation ?? line.touchdowns?.line;
  if (line.position === "QB" && qbPassTdPoints === 6 && passingTouchdowns !== undefined && passingTouchdowns !== null) points += passingTouchdowns * 2;
  if (line.position !== "QB" && line.receptions) points -= line.receptions.line * (1 - pprScoring);
  if (line.position === "TE" && tePremium > 0 && line.receptions) points += line.receptions.line * tePremium;
  return points;
}

function rankableFantasyPoints(line: PlayerLine, qbPassTdPoints: 4 | 6, tePremium: TePremium, pprScoring: PprScoring): number | null {
  return line.fantasyUsesInference ? null : displayedFantasyPoints(line, qbPassTdPoints, tePremium, pprScoring);
}

function projectedPositionRanks(lines: PlayerLine[], qbPassTdPoints: 4 | 6, tePremium: TePremium, pprScoring: PprScoring): Map<string, number> {
  const ranks = new Map<string, number>();
  positions.filter((item): item is Position => item !== "ALL" && item !== "FLEX").forEach((position) => {
    lines
      .filter((line) => line.position === position)
      .filter((line) => rankableFantasyPoints(line, qbPassTdPoints, tePremium, pprScoring) !== null)
      .sort((left, right) => {
        const leftPoints = rankableFantasyPoints(left, qbPassTdPoints, tePremium, pprScoring)!;
        const rightPoints = rankableFantasyPoints(right, qbPassTdPoints, tePremium, pprScoring)!;
        return rightPoints - leftPoints || left.player.localeCompare(right.player);
      })
      .forEach((line, index) => ranks.set(line.id, index + 1));
  });
  return ranks;
}

function visibleOptionalRushingYards(line: PlayerLine): Cell | null {
  const cell = line.rushingYards;
  return cell?.line === 0 && cell.fallbackLabel ? null : cell;
}

function FantasyCell({ line, qbPassTdPoints, tePremium, pprScoring }: { line: PlayerLine; qbPassTdPoints: 4 | 6; tePremium: TePremium; pprScoring: PprScoring }) {
  const points = displayedFantasyPoints(line, qbPassTdPoints, tePremium, pprScoring);
  if (points === null) return <><span className="empty">Not assigned</span><small>Missing a verified prop</small></>;
  if (line.fantasyUsesInference) return <><span className="empty">Not enough verified data</span><strong className="fantasy-points inferred">Estimated {points.toFixed(2)} fantasy pts</strong></>;
  return <><strong className="fantasy-points">{points.toFixed(2)}</strong><small>{line.fantasyBooks.join(" + ")}</small>{line.position === "QB" && <small className="qb-scoring-note">Pass TDs · {qbPassTdPoints} pts</small>}{line.position !== "QB" && <small className="ppr-scoring-note">PPR {pprScoring.toFixed(1)} · {pprScoring.toFixed(1)} pts/reception</small>}{line.position === "TE" && <small className="tep-scoring-note">TEP {tePremium.toFixed(1)} · {(pprScoring + tePremium).toFixed(1)} total pts/reception</small>}</>;
}

function americanOddsLabel(value: number | undefined): string {
  if (!Number.isFinite(value)) return "—";
  return `${value! > 0 ? "+" : ""}${value}`;
}

function touchdownOddsLines(line: PlayerLine): string[] {
  const statTypes: StatType[] = line.position === "QB"
    ? ["passing_touchdowns", "offensive_touchdowns"]
    : (line.sourcesByStat.offensive_touchdowns || []).some((cell) => Number.isFinite(cell.overOdds) || Number.isFinite(cell.higherMultiplier))
      ? ["offensive_touchdowns"]
      : ["rushing_touchdowns", "receiving_touchdowns"];
  return statTypes.flatMap((statType) => (line.sourcesByStat[statType] || [])
    .filter((cell) => cell.status === "open" && (Number.isFinite(cell.overOdds) || Number.isFinite(cell.higherMultiplier)))
    .map((cell) => {
      const statLabel = statType === "offensive_touchdowns" ? "Any TD" : STAT_LABELS[statType];
      if (Number.isFinite(cell.higherMultiplier) && Number.isFinite(cell.lowerMultiplier)) {
        return `${cell.sourceName} ${statLabel} · H ${cell.line} ${cell.higherMultiplier!.toFixed(2)}x / L ${cell.line} ${cell.lowerMultiplier!.toFixed(2)}x`;
      }
      return `${cell.sourceName} ${statLabel} · O ${cell.line} ${americanOddsLabel(cell.overOdds)} / U ${cell.line} ${americanOddsLabel(cell.underOdds)}`;
    }));
}

function TouchdownChanceCell({ line, onInspect }: { line: PlayerLine; onInspect: (statType: StatType) => void }) {
  const oddsLines = touchdownOddsLines(line);
  const oddsDetails = oddsLines.length
    ? oddsLines.map((odds) => <small className="touchdown-odds" key={odds}>{odds}</small>)
    : <small className="touchdown-odds unavailable">O/U odds unavailable{line.fantasyTdOddsBooks.length ? ` · ${line.fantasyTdOddsBooks.join(" + ")}` : ""}</small>;
  const chance = line.touchdownProbability === null
    ? <span className="empty">Not offered</span>
    : <div className="touchdown-chance"><strong>{(line.touchdownProbability * 100).toFixed(1)}%</strong><small>Scores any rush/rec TD</small>{oddsDetails}{line.touchdownProbabilityNote && <small>{line.touchdownProbabilityNote}</small>}</div>;
  if (line.position !== "QB") return chance;
  if (line.passingTouchdownExpectation !== null) {
    return <button className="prop-trigger passing-td-expectation" onClick={() => onInspect("passing_touchdowns")} aria-label={`Compare ${line.player} Passing TDs across sources`}><strong>{line.passingTouchdownExpectation.toFixed(2)}</strong><small>Expected pass TDs · {line.passingTouchdownExpectationLabel}</small>{oddsDetails}</button>;
  }
  if (line.touchdowns) return <LineCell cell={line.touchdowns} label="Pass TD · 4 pts" preferredSource={line.source} player={line.player} onInspect={onInspect} />;
  return chance;
}

function sortValue(line: PlayerLine, key: SortKey, qbPassTdPoints: 4 | 6, tePremium: TePremium, pprScoring: PprScoring): string | number | null {
  if (key === "player") return line.player;
  if (key === "book") return line.book;
  if (key === "yards") return line.yards?.line ?? null;
  if (key === "secondary") return line.position === "QB" ? line.rushingYards?.line ?? null : line.receptions?.line ?? null;
  if (key === "touchdowns") return line.touchdownProbability ?? (line.position === "QB" ? line.touchdowns?.line ?? null : skillTouchdownTotal(line));
  if (key === "fantasyPoints") return rankableFantasyPoints(line, qbPassTdPoints, tePremium, pprScoring);
  if (key === "prizePicksFantasyScore") return line.prizePicksFantasyScore?.line ?? null;
  return { strong: 3, partial: 2, thin: 1 }[line.confidence];
}

function compareLines(a: PlayerLine, b: PlayerLine, sort: SortState, qbPassTdPoints: 4 | 6, tePremium: TePremium, pprScoring: PprScoring): number {
  const aValue = sortValue(a, sort.key, qbPassTdPoints, tePremium, pprScoring);
  const bValue = sortValue(b, sort.key, qbPassTdPoints, tePremium, pprScoring);
  if (aValue === null && bValue !== null) return 1;
  if (aValue !== null && bValue === null) return -1;
  if (aValue === null || bValue === null) return a.player.localeCompare(b.player);
  const comparison = typeof aValue === "number" && typeof bValue === "number"
    ? aValue - bValue
    : String(aValue).localeCompare(String(bValue));
  return (sort.direction === "asc" ? comparison : -comparison) || a.player.localeCompare(b.player) || a.book.localeCompare(b.book);
}

function SortHeader({ sortKey, label, hint, sort, onSort }: { sortKey: SortKey; label: string; hint?: string; sort: SortState; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  return <th scope="col" aria-sort={ariaSort}><button className={`sort-button ${active ? "active" : ""}`} onClick={() => onSort(sortKey)}><span className="column-label">{label}{hint && <small>{hint}</small>}</span><span className="sort-indicator" aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span><span className="sr-only">{active ? `Sorted ${sort.direction === "asc" ? "ascending" : "descending"}. Activate to reverse.` : "Activate to sort."}</span></button></th>;
}

function PlayerLedger({ line, history, onClose }: { line: PlayerLine; history: History; onClose: () => void }) {
  const titleId = `history-title-${line.id}`;
  const categories = [...new Map(([
    [`Primary yards · ${line.yardLabel}`, line.yards],
    ["Receptions", line.receptions],
    [line.position === "QB" ? "Passing TDs" : line.position === "RB" ? "Rushing TDs" : "Receiving TDs", line.touchdowns],
    ["Rushing yards", visibleOptionalRushingYards(line)],
    ["Rushing TDs", line.rushingTouchdowns],
    ["Receiving yards", line.receivingYards],
    ["Receiving TDs", line.receivingTouchdowns],
    ["Rush + receiving TDs", line.offensiveTouchdowns],
  ] as Array<[string, Cell | null]>).filter((entry): entry is [string, Cell] => Boolean(entry[1])).map((entry) => [entry[1].key, entry])).values()];
  return <section className="inline-history" id={`ledger-${line.id}`} aria-labelledby={titleId}><div className="history-heading"><div><p className="eyebrow">Daily audit trail</p><h2 id={titleId}>{line.player} · {line.book}</h2></div><button onClick={onClose} aria-label={`Collapse ${line.player} ledger`}>Collapse</button></div><div className="history-grid">{categories.map(([label, cell]) => { const points = cell ? history[cell.key] || [] : []; return <article key={label}><h3>{label}</h3>{cell?.fallbackLabel ? <p className="history-fallback"><strong>{cell.line}</strong>{cell.fallbackLabel}</p> : points.length ? <ol>{points.slice().reverse().map((point) => <li key={point.date}><time>{point.date}</time><strong>{point.line}</strong><span>{point.changeType.replaceAll("_", " ")}</span></li>)}</ol> : <p>No verified history yet.</p>}</article>; })}</div></section>;
}

function historyChartPoints(cell: Cell, history: History, movements: TrendMove[]): ChartPoint[] {
  const points: ChartPoint[] = (history[cell.key] || [])
    .filter((point) => Number.isFinite(point.line) && !Number.isNaN(Date.parse(`${point.date}T12:00:00Z`)))
    .map((point) => ({ key: point.date, label: point.date.slice(5), order: Date.parse(`${point.date}T12:00:00Z`), line: point.line }));
  const relevantMoves = movements.filter((move) => move.key === cell.key).sort((a, b) => a.date.localeCompare(b.date));
  for (const move of relevantMoves) {
    const moveOrder = Date.parse(`${move.date}T12:00:00Z`);
    if (!points.some((point) => point.order === moveOrder)) {
      points.push({ key: move.date, label: move.date.slice(5), order: moveOrder, line: move.line });
    }
    const priorLine = Number((move.line - move.lineDelta).toFixed(2));
    const prior = points.filter((point) => point.order < moveOrder).sort((a, b) => b.order - a.order)[0];
    if (!prior || prior.line !== priorLine) {
      points.push({ key: `${move.date}:prior`, label: `Before ${move.date.slice(5)}`, order: moveOrder - 1, line: priorLine, reconstructed: true });
    }
  }
  return [...new Map(points.sort((a, b) => a.order - b.order).map((point) => [`${point.order}:${point.line}`, point])).values()];
}

function sportsbookChartSeries(line: PlayerLine, statType: StatType, history: History, movements: TrendMove[]) {
  return (line.sourcesByStat[statType] || [])
    .filter((cell) => cell.source !== "prizepicks")
    .map((cell) => ({ cell, points: historyChartPoints(cell, history, movements) }))
    .filter((series) => series.points.length);
}

function averageChartPoints(series: Array<{ points: ChartPoint[] }>): ChartPoint[] {
  const slots = [...new Map(series.flatMap((item) => item.points).sort((a, b) => a.order - b.order).map((point) => [`${point.order}:${point.label}`, { order: point.order, label: point.label }])).values()];
  return slots.flatMap((slot) => {
    const values = series.flatMap((item) => {
      const point = item.points.filter((candidate) => candidate.order <= slot.order).at(-1);
      return point ? [point.line] : [];
    });
    return values.length ? [{ key: `average:${slot.order}`, label: slot.label, order: slot.order, line: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) }] : [];
  });
}

function sportsbookAverageMovements(lines: PlayerLine[], history: History, movements: TrendMove[], options: { includePrizePicks?: boolean; minimumPairs?: number } = {}): TrendMove[] {
  const includePrizePicks = options.includePrizePicks || false;
  const minimumPairs = options.minimumPairs ?? 2;
  const lineByPlayer = new Map(lines.map((line) => [line.id, line]));
  const eventGroups = new Map<string, TrendMove[]>();
  movements.forEach((move) => {
    const key = `${move.date}:${move.player.id}:${move.statType}`;
    eventGroups.set(key, [...(eventGroups.get(key) || []), move]);
  });

  const results: TrendMove[] = [];
  for (const group of eventGroups.values()) {
    const event = group[0];
    const line = lineByPlayer.get(event.player.id);
    if (!line) continue;
    const series = includePrizePicks
      ? (line.sourcesByStat[event.statType] || []).map((cell) => ({ cell, points: historyChartPoints(cell, history, movements) })).filter((item) => item.points.length)
      : sportsbookChartSeries(line, event.statType, history, movements);
    const eventOrder = Date.parse(`${event.date}T12:00:00Z`);
    const paired = series.flatMap((item) => {
      const before = item.points.filter((point) => point.order < eventOrder).at(-1);
      const after = item.points.filter((point) => point.order <= eventOrder).at(-1);
      return before && after ? [{ before: before.line, after: after.line, source: item.cell.source, sourceName: item.cell.sourceName, sourceUrl: item.cell.sourceUrl }] : [];
    });
    if (paired.length < minimumPairs) continue;
    const beforeAverage = paired.reduce((sum, pair) => sum + pair.before, 0) / paired.length;
    const afterAverage = paired.reduce((sum, pair) => sum + pair.after, 0) / paired.length;
    const lineDelta = Number((afterAverage - beforeAverage).toFixed(2));
    if (lineDelta === 0) continue;
    results.push({
      date: event.date,
      key: `${includePrizePicks ? "weekly-average" : "sportsbook-average"}:${event.player.id}:${event.statType}`,
      source: paired.length === 1 ? paired[0].source : "average",
      sourceName: paired.length === 1 ? paired[0].sourceName : `Average of ${paired.length} ${includePrizePicks ? "sources" : "sportsbooks"}`,
      sourceUrl: paired.length === 1 ? paired[0].sourceUrl : "#",
      player: event.player,
      statType: event.statType,
      line: Number(afterAverage.toFixed(2)),
      lineDelta,
      changeType: lineDelta > 0 ? "line_increased" : "line_decreased",
    });
  }
  return results;
}

function LineHistoryChart({ line, statType, history, movements, highlightedSource }: { line: PlayerLine; statType: StatType; history: History; movements: TrendMove[]; highlightedSource?: string }) {
  const rawSeries = (line.sourcesByStat[statType] || []).map((cell) => ({ cell, points: historyChartPoints(cell, history, movements) })).filter((series) => series.points.length);
  const series = rawSeries.sort((a, b) => Number(b.cell.source === highlightedSource) - Number(a.cell.source === highlightedSource) || a.cell.sourceName.localeCompare(b.cell.sourceName));
  if (!series.length) return <div className="line-history-empty"><strong>No chartable history yet.</strong><span>The first verified capture becomes the opening point.</span></div>;

  const sportsbookSeries = series.filter((item) => item.cell.source !== "prizepicks");
  const averagePoints = averageChartPoints(sportsbookSeries);
  const slots = [...new Map([...series.flatMap((item) => item.points), ...averagePoints].sort((a, b) => a.order - b.order).map((point) => [`${point.order}:${point.label}`, { order: point.order, label: point.label }])).values()];
  const values = [...series.flatMap((item) => item.points.map((point) => point.line)), ...averagePoints.map((point) => point.line)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = max === min ? Math.max(Math.abs(max) * 0.02, 1) : (max - min) * 0.15;
  const domainMin = min - padding;
  const domainMax = max + padding;
  const width = 900;
  const height = 320;
  const left = 72;
  const right = 26;
  const top = 24;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (order: number) => left + (slots.length === 1 ? plotWidth / 2 : slots.findIndex((slot) => slot.order === order) * plotWidth / (slots.length - 1));
  const y = (value: number) => top + (domainMax - value) * plotHeight / (domainMax - domainMin);
  const yTicks = Array.from({ length: 5 }, (_, index) => domainMin + (domainMax - domainMin) * index / 4).reverse();
  const xTickSlots = slots.length <= 6 ? slots : slots.filter((_, index) => index === 0 || index === slots.length - 1 || index % Math.ceil((slots.length - 1) / 5) === 0).slice(0, 6);
  const formatLine = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const summary = `${line.player} ${STAT_LABELS[statType]} history across ${series.length} source${series.length === 1 ? "" : "s"}, ranging from ${formatLine(min)} to ${formatLine(max)}.${averagePoints.length ? ` The slightly thicker neon-green line is the average of ${sportsbookSeries.length} sportsbooks.` : ""}`;

  return <section className="line-history-chart" aria-labelledby={`chart-title-${line.id}-${statType}`}>
    <div className="line-chart-heading"><div><p className="eyebrow">Visual history</p><h3 id={`chart-title-${line.id}-${statType}`}>Line trend</h3></div><div className="line-chart-key" aria-label="Chart key">{averagePoints.length > 0 && <span className="average"><i />Sportsbook average · primary trend</span>}</div></div>
    <div className="line-chart-series" aria-label="Sources">{averagePoints.length > 0 && <span className="average"><i className="series-marker" />Average of all sportsbooks · monitored trend</span>}{series.map((item) => <span className={item.cell.source === highlightedSource ? "highlighted" : ""} key={item.cell.key}><i className={`series-marker source-${item.cell.source}`} />{item.cell.sourceName}{item.cell.source === highlightedSource ? " · selected move" : ""}</span>)}</div>
    <div className="line-chart-scroll"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
      <title>{line.player} · {STAT_LABELS[statType]} line history</title><desc>{summary} DraftKings is green, FanDuel is blue, BetMGM is gold, PrizePicks is purple, and Underdog is yellow.</desc>
      <rect className="chart-frame" x={left} y={top} width={plotWidth} height={plotHeight} />
      {yTicks.map((tick) => <g key={tick}><line className="chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text className="chart-axis-label" x={left - 10} y={y(tick) + 4} textAnchor="end">{formatLine(tick)}</text></g>)}
      {xTickSlots.map((slot) => <g key={`${slot.order}:${slot.label}`}><line className="chart-tick" x1={x(slot.order)} x2={x(slot.order)} y1={height - bottom} y2={height - bottom + 6} /><text className="chart-axis-label" x={x(slot.order)} y={height - bottom + 24} textAnchor="middle">{slot.label}</text></g>)}
      <text className="chart-axis-title" x={left + plotWidth / 2} y={height - 8} textAnchor="middle">Capture date</text>
      <text className="chart-axis-title" transform={`translate(18 ${top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">Prop line</text>
      {series.map((item) => <g className={`chart-series source-${item.cell.source}${item.cell.source === highlightedSource ? " highlighted" : ""}`} key={item.cell.key}>
        {item.points.slice(1).map((point, index) => { const previous = item.points[index]; return <line className="chart-segment" key={`${previous.key}:${point.key}`} x1={x(previous.order)} y1={y(previous.line)} x2={x(point.order)} y2={y(point.line)} />; })}
        {item.points.map((point) => <g key={point.key}><circle className={`chart-point source-${item.cell.source} ${point.reconstructed ? "reconstructed" : ""}`} cx={x(point.order)} cy={y(point.line)} r={item.cell.source === highlightedSource ? 6 : 5}><title>{item.cell.sourceName} · {point.label}: {formatLine(point.line)}{point.reconstructed ? " (prior line reconstructed from verified movement)" : ""}</title></circle>{item.points.length <= 6 && <text className="chart-value" x={x(point.order)} y={y(point.line) - 11} textAnchor="middle">{formatLine(point.line)}</text>}</g>)}
      </g>)}
      {averagePoints.length > 0 && <g className="chart-average">
        {averagePoints.slice(1).map((point, index) => { const previous = averagePoints[index]; return <line key={`${previous.key}:${point.key}`} x1={x(previous.order)} y1={y(previous.line)} x2={x(point.order)} y2={y(point.line)} />; })}
        {averagePoints.map((point) => <circle key={point.key} cx={x(point.order)} cy={y(point.line)} r={6}><title>Sportsbook average · {point.label}: {formatLine(point.line)}</title></circle>)}
      </g>}
    </svg></div>
    {series.some((item) => item.points.some((point) => point.reconstructed)) && <p className="chart-note">“Before” points reconstruct the exact prior line from the verified movement amount.</p>}
  </section>;
}

function PropComparison({ line, statType, history, movements, highlightedSource, onBackAll, onClose }: { line: PlayerLine; statType: StatType; history: History; movements: TrendMove[]; highlightedSource?: string; onBackAll: () => void; onClose: () => void }) {
  const titleId = `comparison-title-${line.id}-${statType}`;
  const sources = line.sourcesByStat[statType] || [];
  const consensus = [line.yards, line.receptions, line.touchdowns, line.rushingYards, line.rushingTouchdowns, line.receivingYards, line.receivingTouchdowns, line.offensiveTouchdowns]
    .find((cell) => cell?.statType === statType && !cell.fallbackLabel) || null;
  const explanation = consensus?.consensusMethod === "mode"
    ? `${consensus.supportCount} of ${consensus.sourceCount} sources share this line, so it is the main line.`
    : consensus?.consensusMethod === "average"
      ? `The main line is the arithmetic average of all ${consensus.sourceCount} current sources.`
      : "This is the only current source carrying the prop.";
  return <section className="prop-comparison" id={`ledger-${line.id}`} aria-labelledby={titleId}>
    <div className="comparison-heading"><div><p className="eyebrow">All source lines</p><h2 id={titleId}>{line.player} · {STAT_LABELS[statType]}</h2></div><div className="comparison-actions"><button className="back-all" onClick={onBackAll}>← Back to all players</button><button onClick={onClose} aria-label={`Close ${line.player} ${STAT_LABELS[statType]} comparison`}>Close</button></div></div>
    <div className="consensus-summary"><span>Main line</span><strong>{consensus?.line.toLocaleString() || "—"}</strong><p>{explanation}</p></div>
    <LineHistoryChart line={line} statType={statType} history={history} movements={movements} highlightedSource={highlightedSource} />
    <div className="source-comparison" role="list" aria-label={`${line.player} ${STAT_LABELS[statType]} source lines`}>{sources.map((source) => <article className={source.source === highlightedSource ? "highlighted" : ""} key={source.key} role="listitem"><div><strong>{source.sourceName}</strong><small>{source.source === "prizepicks" ? "Projection line" : source.source === "underdog" ? "Pick’em modifiers" : "Sportsbook line"}</small></div><b>{source.line.toLocaleString()}</b><div className="source-odds">{source.higherMultiplier !== undefined && source.lowerMultiplier !== undefined ? <><span>H {source.higherMultiplier.toFixed(2)}x</span><span>L {source.lowerMultiplier.toFixed(2)}x</span></> : source.overOdds !== undefined && source.underOdds !== undefined ? <><span>O {source.overOdds > 0 ? "+" : ""}{source.overOdds}</span><span>U {source.underOdds > 0 ? "+" : ""}{source.underOdds}</span></> : <span>No odds posted</span>}</div>{source.sourceUrl && source.sourceUrl !== "#" && <a href={source.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}</article>)}</div>
  </section>;
}

function redraftNameKey(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function missingFantasyInputs(line: PlayerLine | undefined): string[] {
  if (!line) return ["No ledger match"];
  if (line.position === "QB") return [!line.yards && "passing yards", !line.touchdowns && "passing TDs"].filter((item): item is string => Boolean(item));
  if (line.position === "RB") return [!line.rushingYards && "rushing yards", !line.receptions && "receptions", !(line.offensiveTouchdowns || line.rushingTouchdowns) && "total TDs"].filter((item): item is string => Boolean(item));
  return [!line.receivingYards && "receiving yards", !line.receptions && "receptions", !(line.offensiveTouchdowns || line.receivingTouchdowns) && "total TDs"].filter((item): item is string => Boolean(item));
}

function sleeperValueRows(players: SleeperAdpPlayer[], seasonLines: PlayerLine[]): SleeperValueRow[] {
  const lineByPlayer = new Map(seasonLines.map((line) => [`${line.position}:${redraftNameKey(line.player)}`, line]));
  const sleeperPositionRanks = new Map<string, number>();
  positions.filter((item): item is Position => item !== "ALL").forEach((position) => {
    players.filter((player) => player.position === position).sort((left, right) => left.adp - right.adp).forEach((player, index) => sleeperPositionRanks.set(player.id, index + 1));
  });
  const comparableSleeperPositionRanks = new Map<string, number>();
  const projectedPositionRanks = new Map<string, number>();
  positions.filter((item): item is Position => item !== "ALL").forEach((position) => {
    const comparable = players
      .filter((player) => player.position === position)
      .map((player) => ({ player, line: lineByPlayer.get(`${position}:${redraftNameKey(player.name)}`) }))
      .filter((item): item is { player: SleeperAdpPlayer; line: PlayerLine } => item.line?.fantasyPoints !== null && item.line?.fantasyPoints !== undefined && !item.line.fantasyUsesInference);
    comparable
      .sort((left, right) => left.player.adp - right.player.adp)
      .forEach((item, index) => comparableSleeperPositionRanks.set(item.player.id, index + 1));
    comparable
      .sort((left, right) => right.line.fantasyPoints! - left.line.fantasyPoints! || left.player.name.localeCompare(right.player.name))
      .forEach((item, index) => projectedPositionRanks.set(item.player.id, index + 1));
  });
  return players.map((player) => {
    const key = `${player.position}:${redraftNameKey(player.name)}`;
    const line = lineByPlayer.get(key);
    const sleeperPositionRank = sleeperPositionRanks.get(player.id)!;
    const comparableSleeperPositionRank = comparableSleeperPositionRanks.get(player.id) ?? null;
    const projectedPositionRank = projectedPositionRanks.get(player.id) ?? null;
    return {
      ...player,
      sleeperPositionRank,
      comparableSleeperPositionRank,
      projectedPoints: line && !line.fantasyUsesInference ? line.fantasyPoints : null,
      inferredProjectedPoints: line?.fantasyUsesInference ? line.fantasyPoints : null,
      projectedPositionRank,
      valueGap: projectedPositionRank === null || comparableSleeperPositionRank === null ? null : comparableSleeperPositionRank - projectedPositionRank,
      missingInputs: !line ? missingFantasyInputs(line) : line.fantasyUsesInference ? ["inferred inputs"] : line.fantasyPoints === null ? missingFantasyInputs(line) : [],
      confidence: line?.confidence ?? null,
      confidenceNote: line?.confidenceNote ?? null,
    };
  });
}

function sleeperMoveInRange(move: SleeperAdpMove, range: TrendRange, currentDate?: string): boolean {
  if (range === "all") return true;
  if (!currentDate) return false;
  if (range === "today") return move.date === currentDate;
  const weekStart = new Date(Date.parse(`${currentDate}T12:00:00Z`) - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return move.date >= weekStart && move.date <= currentDate;
}

function SleeperAdpChart({ player, history, onClose }: { player: SleeperAdpPlayer; history: SleeperAdpHistory; onClose: () => void }) {
  const points = history[player.id] || [];
  const width = 660;
  const height = 270;
  const left = 58;
  const right = 26;
  const top = 32;
  const bottom = 52;
  const values = points.length ? points.map((point) => point.adp) : [player.adp];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(1, (max - min) * 0.2);
  const yMin = Math.max(0, min - padding);
  const yMax = max + padding;
  const x = (index: number) => left + (points.length <= 1 ? (width - left - right) / 2 : index * (width - left - right) / (points.length - 1));
  const y = (value: number) => top + ((value - yMin) / Math.max(1, yMax - yMin)) * (height - top - bottom);
  return <div className="graph-drawer-layer" role="dialog" aria-modal="true" aria-labelledby="sleeper-chart-title"><button className="graph-drawer-scrim" onClick={onClose} aria-label="Close ADP history" /><aside className="graph-drawer sleeper-adp-drawer"><section className="prop-comparison"><div className="comparison-heading"><div><p className="eyebrow">Sleeper ADP history</p><h2 id="sleeper-chart-title">{player.name} · {player.position}</h2></div><button onClick={onClose}>Close</button></div><div className="sleeper-chart-summary"><span>Current ADP</span><strong>{player.adp.toFixed(1)}</strong><p>Lower ADP means the player is being drafted earlier. Today is the first recorded point when no prior capture exists.</p></div><div className="line-history-chart"><div className="line-chart-scroll"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${player.name} Sleeper ADP history`}><rect className="chart-frame" x={left} y={top} width={width - left - right} height={height - top - bottom} /><text className="chart-axis-title" transform={`translate(18 ${top + (height - top - bottom) / 2}) rotate(-90)`} textAnchor="middle">ADP · lower is earlier</text>{points.length > 1 && points.slice(1).map((point, index) => <line className="sleeper-adp-segment" key={`${point.date}:line`} x1={x(index)} y1={y(points[index].adp)} x2={x(index + 1)} y2={y(point.adp)} />)}{(points.length ? points : [{ date: player.id, adp: player.adp, rank: player.rank }]).map((point, index) => <g key={point.date}><circle className="sleeper-adp-point" cx={x(index)} cy={y(point.adp)} r={6}><title>{point.date}: {point.adp.toFixed(1)}</title></circle><text className="chart-value" x={x(index)} y={y(point.adp) - 12} textAnchor="middle">{point.adp.toFixed(1)}</text><text className="chart-axis-label" x={x(index)} y={height - 20} textAnchor="middle">{point.date.slice(5)}</text></g>)}</svg></div></div></section></aside></div>;
}

function SleeperTrendCard({ snapshot, range, onRange, onSelect }: { snapshot: SleeperAdpSnapshot; range: TrendRange; onRange: (range: TrendRange) => void; onSelect: (player: SleeperAdpMove["player"]) => void }) {
  const moves = (snapshot.movements || []).filter((move) => sleeperMoveInRange(move, range, snapshot.date)).sort((left, right) => right.date.localeCompare(left.date) || Math.abs(right.adpDelta) - Math.abs(left.adpDelta));
  const rises = moves.filter((move) => move.adpDelta < 0).length;
  const falls = moves.filter((move) => move.adpDelta > 0).length;
  return <section className="trend-card" aria-labelledby="sleeper-trend-title"><div className="trend-heading"><div><p className="eyebrow">Draft pulse</p><h2 id="sleeper-trend-title">ADP movement</h2></div><span className="trend-live"><i aria-hidden="true" />Sleeper</span></div><div className="trend-range" role="group" aria-label="ADP movement time range">{(["today", "week", "all"] as TrendRange[]).map((item) => <button key={item} className={range === item ? "active" : ""} aria-pressed={range === item} onClick={() => onRange(item)}>{item === "all" ? "All history" : item[0].toUpperCase() + item.slice(1)}</button>)}</div><div className="trend-counts"><span className="trend-up">↑ {rises} rising</span><span className="trend-down">↓ {falls} falling</span></div>{moves.length ? <ol className="trend-list">{moves.map((move) => { const rising = move.adpDelta < 0; return <li key={`${move.date}:${move.player.id}`}><button onClick={() => onSelect(move.player)}><span className={`trend-arrow ${rising ? "trend-up" : "trend-down"}`}>{rising ? "↑" : "↓"}</span><span className="trend-player"><strong>{move.player.name}</strong><small>{move.player.position} · {range !== "today" ? `${move.date.slice(5)} · ` : ""}{Math.abs(move.adpDelta).toFixed(1)} picks</small></span><span className="trend-value"><strong>{move.adp.toFixed(1)}</strong><small className={rising ? "trend-up" : "trend-down"}>{rising ? "earlier" : "later"}</small></span></button></li>; })}</ol> : <p className="trend-empty">{snapshot.players.length ? "ADP changes will appear after the next verified daily capture." : "The board is ready for its first verified Sleeper capture."}</p>}</section>;
}

function SleeperRedraftBoardV2({ snapshot, history, seasonLines }: { snapshot: SleeperAdpSnapshot; history: SleeperAdpHistory; seasonLines: PlayerLine[] }) {
  const [position, setPosition] = useState<(typeof positions)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [coverageFilter, setCoverageFilter] = useState<SleeperCoverageFilter>("all");
  const [sort, setSort] = useState<{ key: SleeperSortKey; direction: "asc" | "desc" }>({ key: "valueGap", direction: "desc" });
  const [range, setRange] = useState<TrendRange>("today");
  const [chartPlayer, setChartPlayer] = useState<SleeperAdpPlayer | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<SleeperColumnKey>>(() => new Set());
  const valueRows = useMemo(() => sleeperValueRows(snapshot.players || [], seasonLines), [snapshot.players, seasonLines]);
  const currentAdpDelta = useMemo(() => new Map((snapshot.movements || []).filter((move) => move.date === snapshot.date).map((move) => [move.player.id, move.adpDelta])), [snapshot.movements, snapshot.date]);
  const filtered = useMemo(() => valueRows
    .filter((row) => matchesPositionFilter(row.position, position))
    .filter((row) => coverageFilter === "all" || (coverageFilter === "comparable" ? row.projectedPositionRank !== null : row.projectedPositionRank === null))
    .filter((row) => `${row.name} ${row.team}`.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => {
      const value = (row: SleeperValueRow) => sort.key === "player" ? row.name : sort.key === "trend" ? currentAdpDelta.get(row.id) ?? null : row[sort.key];
      const a = value(left);
      const b = value(right);
      if (a === null && b !== null) return 1;
      if (a !== null && b === null) return -1;
      const compared = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      return (sort.direction === "asc" ? compared : -compared) || left.adp - right.adp;
    }), [valueRows, position, coverageFilter, query, sort, currentAdpDelta]);
  const sortBy = (key: SleeperSortKey) => setSort((current) => current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: ["player", "adp", "sleeperPositionRank", "comparableSleeperPositionRank", "projectedPositionRank"].includes(key) ? "asc" : "desc" });
  const focusTrend = (player: SleeperAdpMove["player"]) => {
    setPosition("ALL");
    setCoverageFilter("all");
    setQuery(player.name);
    setChartPlayer(snapshot.players.find((item) => item.id === player.id) || null);
  };
  const reset = () => { setPosition("ALL"); setCoverageFilter("all"); setQuery(""); setChartPlayer(null); };
  const matched = valueRows.filter((row) => row.projectedPositionRank !== null).length;
  const coverageRows = valueRows.filter((row) => matchesPositionFilter(row.position, position));
  const coverageMatched = coverageRows.filter((row) => row.projectedPositionRank !== null).length;
  const coverageLabel = position === "ALL"
    ? `${coverageMatched} of ${coverageRows.length} players comparable`
    : `${coverageMatched} of ${coverageRows.length} ${position === "FLEX" ? "FLEX players" : `${position}s`} comparable`;
  const format = snapshot.format;
  const header = (key: SleeperSortKey, label: string, hint: string) => <th><button className={`sort-button ${sort.key === key ? "active" : ""}`} onClick={() => sortBy(key)}><span className="column-label">{label}<small>{hint}</small></span><span>↕</span></button></th>;
  const columnChoices: Array<{ key: SleeperColumnKey; label: string }> = [
    { key: "adp", label: "Sleeper ADP" },
    { key: "sleeperPositionRank", label: "Sleeper position rank" },
    { key: "comparableSleeperPositionRank", label: "Comparable ADP rank" },
    { key: "projectedPoints", label: "Our fantasy points" },
    { key: "projectedPositionRank", label: "Our comparable rank" },
    { key: "valueGap", label: "Value gap" },
    { key: "trend", label: "ADP trend" },
    { key: "coverage", label: "Coverage" },
  ];
  const columnVisible = (key: string) => !hiddenColumns.has(key as SleeperColumnKey);
  const toggleColumn = (key: string) => {
    const column = key as SleeperColumnKey;
    const hiding = !hiddenColumns.has(column);
    setHiddenColumns((current) => { const next = new Set(current); if (next.has(column)) next.delete(column); else next.add(column); return next; });
    if (hiding && column !== "coverage" && sort.key === column) setSort({ key: "player", direction: "asc" });
  };
  const visibleColumnCount = 1 + columnChoices.filter((choice) => columnVisible(choice.key)).length;

  return <>
    <section className="hero sleeper-hero" id="top">
      <div><p className="eyebrow">12-team full-PPR draft intelligence</p><h1>Sleeper ADP.<br /><span>Priced against us.</span></h1><p className="lede">Daily Sleeper draft cost compared position-by-position with this ledger’s season fantasy projections. Value gaps use only players with complete projections, so missing prop markets never distort the comparison.</p></div>
      <div className="hero-sidebar"><div className="capture-card"><div className="capture-topline"><span>Latest ADP capture</span><span className="status-pill">{snapshot.players.length ? "Double-checked" : "Ready"}</span></div><strong>{snapshot.date ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${snapshot.date}T12:00:00Z`)) : "First capture pending"}</strong><div className="capture-stats"><div><b>{snapshot.players.length}</b><span>players ranked</span></div><div><b>{matched}</b><span>comparable players</span></div><div><b>{format?.rounds || 13}</b><span>draft rounds</span></div></div><p>12 teams · full PPR · 4-point passing TDs · 1QB · 2RB · 2WR · 1TE · 2 FLEX · no K/DST.</p></div></div>
    </section>
    <div className="dashboard-layout">
      <aside className="trend-column"><SleeperTrendCard snapshot={snapshot} range={range} onRange={setRange} onSelect={focusTrend} /></aside>
      <section className="ledger" aria-labelledby="sleeper-ledger-title">
        <div className="ledger-heading"><div><p className="eyebrow">Coverage-adjusted value board</p><h2 id="sleeper-ledger-title">Sleeper redraft</h2></div><div className="ledger-tools">{(query || position !== "ALL" || coverageFilter !== "all") && <button className="back-to-all" onClick={reset}>← Back to all players</button>}<label className="search"><span className="sr-only">Search Sleeper players</span><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player or team" /></label></div></div>
        <div className="filters sleeper-filters"><div className="position-tabs" role="group" aria-label="Position">{positions.map((item) => <button key={item} className={position === item ? "active" : ""} onClick={() => setPosition(item)}>{item}</button>)}</div><div className="sleeper-coverage-controls"><div className="coverage-tabs" role="group" aria-label="Projection coverage">{(["all", "comparable", "needs-data"] as SleeperCoverageFilter[]).map((item) => <button key={item} className={coverageFilter === item ? "active" : ""} aria-pressed={coverageFilter === item} onClick={() => setCoverageFilter(item)}>{item === "all" ? "All players" : item === "comparable" ? "Comparable only" : "Needs data"}</button>)}</div><div className="sleeper-format-chip">12-team · PPR · 4PT pass TD · no K/DST</div><div className="coverage-summary">{coverageLabel}</div></div></div>
        <div className="coverage-explainer"><strong>Fair comparison:</strong> comparable ADP rank and our projection rank use the same complete-player pool within each position.</div>
        <div className="table-wrap"><table className="sleeper-table" style={{ minWidth: `${Math.max(620, 240 + (visibleColumnCount - 1) * 175)}px` }}><thead><tr>
          {header("player", "Player", "Sleeper draft board")}
          {columnVisible("adp") && header("adp", "Sleeper ADP", "Overall draft cost")}
          {columnVisible("sleeperPositionRank") && header("sleeperPositionRank", "Sleeper pos rank", "Full positional pool")}
          {columnVisible("comparableSleeperPositionRank") && header("comparableSleeperPositionRank", "Comparable ADP rank", "Complete players only")}
          {columnVisible("projectedPoints") && header("projectedPoints", "Our fantasy points", "Full PPR · 4PT pass TD")}
          {columnVisible("projectedPositionRank") && header("projectedPositionRank", "Our comparable rank", "Same complete-player pool")}
          {columnVisible("valueGap") && header("valueGap", "Value gap", "Comparable ADP rank − our rank")}
          {columnVisible("trend") && header("trend", "ADP trend", "Daily movement")}
          {columnVisible("coverage") && <th>Coverage</th>}
        </tr></thead><tbody>{filtered.map((row) => {
          const delta = currentAdpDelta.get(row.id);
          const rising = delta !== undefined && delta < 0;
          return <tr className="data-row" key={row.id}>
            <td><div className="player-cell"><span className={`position position-${row.position.toLowerCase()}`}>{row.position}</span><div><strong>{row.name}</strong><span>{row.team || "FA"}{row.bye ? ` · Bye ${row.bye}` : ""}</span><button className="ledger-link" onClick={() => setChartPlayer(row)}>View ADP graph</button></div></div></td>
            {columnVisible("adp") && <td><strong className="adp-number">{row.adp.toFixed(1)}</strong><small>Overall</small></td>}
            {columnVisible("sleeperPositionRank") && <td><strong>{row.position}{row.sleeperPositionRank}</strong><small>All Sleeper {row.position}s</small></td>}
            {columnVisible("comparableSleeperPositionRank") && <td>{row.comparableSleeperPositionRank === null ? <span className="empty">—</span> : <><strong>{row.position}{row.comparableSleeperPositionRank}</strong><small>Complete pool</small></>}</td>}
            {columnVisible("projectedPoints") && <td>{row.projectedPoints === null ? <><span className="empty">Not projected</span>{row.inferredProjectedPoints !== null ? <strong className="fantasy-points inferred">Estimated {row.inferredProjectedPoints.toFixed(2)} fantasy pts</strong> : <small>{row.missingInputs.join(" + ")}</small>}</> : <><strong className="fantasy-points">{row.projectedPoints.toFixed(2)}</strong><small>Our ledger</small></>}</td>}
            {columnVisible("projectedPositionRank") && <td>{row.projectedPositionRank === null ? <span className="empty">—</span> : <><strong>{row.position}{row.projectedPositionRank}</strong><small>Complete pool</small></>}</td>}
            {columnVisible("valueGap") && <td>{row.valueGap === null ? <span className="needs-data-badge">Needs data</span> : <span className={`value-gap ${row.valueGap > 0 ? "positive" : row.valueGap < 0 ? "negative" : "even"}`}><strong>{row.valueGap > 0 ? "+" : ""}{row.valueGap}</strong><small>{row.valueGap > 0 ? "Our projection higher" : row.valueGap < 0 ? "Sleeper higher" : "Same rank"}</small></span>}</td>}
            {columnVisible("trend") && <td>{delta === undefined ? <span className="delta muted">—</span> : <button className="adp-trend-button" onClick={() => setChartPlayer(row)}><span className={`delta ${rising ? "up" : "down"}`}>{rising ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}</span><small>{rising ? "Earlier" : "Later"}</small></button>}</td>}
            {columnVisible("coverage") && <td>{row.projectedPositionRank !== null ? <><span className={`confidence ${row.confidence || "partial"}`}><i />Comparable</span><small>{row.confidenceNote}</small></> : <><span className="confidence thin"><i />Needs data</span><small>{row.missingInputs.join(" + ")}</small></>}</td>}
          </tr>;
        })}{!filtered.length && <tr><td colSpan={visibleColumnCount} className="empty-state">{snapshot.players.length ? coverageFilter === "needs-data" ? "Every player in this view has a complete projection." : "No players match these filters." : "Run the first verified Sleeper ADP capture to populate this board."}</td></tr>}</tbody></table></div>
      </section>
    </div>
    {chartPlayer && <SleeperAdpChart player={chartPlayer} history={history} onClose={() => setChartPlayer(null)} />}
    <ColumnChooser choices={columnChoices} isVisible={columnVisible} onToggle={toggleColumn} onShowAll={() => setHiddenColumns(new Set())} />
  </>;
}

export default function Home() {
  const [seasonSnapshot, setSeasonSnapshot] = useState<Snapshot>({ demo: true, observations: [], sourceRuns: [] });
  const [weeklySnapshot, setWeeklySnapshot] = useState<Snapshot>({ demo: false, season: 2026, week: 1, observations: [], sourceRuns: [] });
  const [seasonHistory, setSeasonHistory] = useState<History>({});
  const [weeklyHistory, setWeeklyHistory] = useState<History>({});
  const [sleeperSnapshot, setSleeperSnapshot] = useState<SleeperAdpSnapshot>({ demo: false, source: "sleeper", players: [], movements: [] });
  const [sleeperHistory, setSleeperHistory] = useState<SleeperAdpHistory>({});
  const [boardMode, setBoardMode] = useState<BoardMode>("season");
  const [position, setPosition] = useState<(typeof positions)[number]>("ALL");
  const [book, setBook] = useState("All sources");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ playerId: string; statType: StatType | null; source?: string } | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "yards", direction: "desc" });
  const [trendRange, setTrendRange] = useState<TrendRange>("today");
  const [newPropRange, setNewPropRange] = useState<TrendRange>("today");
  const [qbPassTdPoints, setQbPassTdPoints] = useState<4 | 6>(4);
  const [tePremium, setTePremium] = useState<TePremium>(0);
  const [pprScoring, setPprScoring] = useState<PprScoring>(1);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ProjectionColumnKey>>(() => new Set());

  useEffect(() => {
    const dataRoot = import.meta.env.BASE_URL;
    Promise.all([
      fetch(`${dataRoot}data/current.json`).then((response) => response.json()),
      fetch(`${dataRoot}data/history.json`).then((response) => response.json()),
      fetch(`${dataRoot}data/week-1.json`).then((response) => response.json()),
      fetch(`${dataRoot}data/week-1-history.json`).then((response) => response.json()),
      fetch(`${dataRoot}data/sleeper-redraft.json`).then((response) => response.json()),
      fetch(`${dataRoot}data/sleeper-redraft-history.json`).then((response) => response.json()),
    ])
      .then(([nextSeasonSnapshot, nextSeasonHistory, nextWeeklySnapshot, nextWeeklyHistory, nextSleeperSnapshot, nextSleeperHistory]) => {
        setSeasonSnapshot(nextSeasonSnapshot);
        setSeasonHistory(nextSeasonHistory);
        setWeeklySnapshot(nextWeeklySnapshot);
        setWeeklyHistory(nextWeeklyHistory);
        setSleeperSnapshot(nextSleeperSnapshot);
        setSleeperHistory(nextSleeperHistory);
      })
      .catch(() => setSeasonSnapshot({ demo: true, observations: [], sourceRuns: [] }));
  }, []);

  useEffect(() => {
    if (!selected?.statType) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selected?.statType]);

  const snapshot = boardMode === "season" ? seasonSnapshot : weeklySnapshot;
  const history = boardMode === "season" ? seasonHistory : weeklyHistory;
  const waitingForWeekly = boardMode === "week1" && snapshot.observations.length === 0;
  const allLines = useMemo(() => { const live = aggregate(snapshot, boardMode === "season" ? weeklySnapshot : undefined); return live.length ? live : boardMode === "season" ? DEMO_LINES : []; }, [snapshot, boardMode, weeklySnapshot]);
  const sleeperSeasonLines = useMemo(() => aggregate(seasonSnapshot, weeklySnapshot), [seasonSnapshot, weeklySnapshot]);
  const activePropLine = selected?.statType ? allLines.find((line) => line.id === selected.playerId) || null : null;
  const trendMoves = useMemo(() => {
    const fallback = snapshot.observations
      .filter((item) => item.status === "open" && item.lineDelta !== null && item.lineDelta !== 0)
      .map((item) => ({ ...item, date: snapshot.date || "", lineDelta: item.lineDelta!, changeType: (item.lineDelta! > 0 ? "line_increased" : "line_decreased") as TrendMove["changeType"] }));
    const rawMoves = snapshot.movements || fallback;
    const allMoves = sportsbookAverageMovements(allLines, history, rawMoves, boardMode === "week1" ? { includePrizePicks: true, minimumPairs: 1 } : undefined);
    const currentDate = snapshot.date ? new Date(`${snapshot.date}T12:00:00Z`) : null;
    const weekStart = currentDate ? new Date(currentDate.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
    return allMoves
      .filter((move) => trendRange === "all" || (trendRange === "today" ? move.date === snapshot.date : move.date >= weekStart && move.date <= (snapshot.date || "")))
      .sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.lineDelta) - Math.abs(a.lineDelta) || a.player.name.localeCompare(b.player.name));
  }, [snapshot, allLines, history, trendRange, boardMode]);
  const newProps = useMemo(() => newPropsInRange(snapshot, history, newPropRange), [snapshot, history, newPropRange]);
  const books = useMemo(() => ["All sources", ...new Set(allLines.flatMap((line) => line.availableBooks))], [allLines]);
  const positionRanks = useMemo(() => projectedPositionRanks(allLines, qbPassTdPoints, tePremium, pprScoring), [allLines, qbPassTdPoints, tePremium, pprScoring]);
  const lines = useMemo(() => allLines.filter((line) => matchesPositionFilter(line.position, position)).filter((line) => book === "All sources" || line.availableBooks.includes(book)).filter((line) => `${line.player} ${line.team}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => compareLines(a, b, sort, qbPassTdPoints, tePremium, pprScoring)), [allLines, position, book, query, sort, qbPassTdPoints, tePremium, pprScoring]);
  const changeSort = (key: SortKey) => setSort((current) => current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: ["yards", "secondary", "touchdowns", "fantasyPoints", "prizePicksFantasyScore"].includes(key) ? "desc" : "asc" });
  const columnChoices: Array<{ key: ProjectionColumnKey; label: string }> = [
    { key: "yards", label: "Yards" },
    { key: "secondary", label: position === "QB" ? "Rushing yards" : position === "ALL" ? "Receptions / QB rush yards" : "Receptions" },
    { key: "touchdowns", label: boardMode === "week1" ? "TD chance" : "Touchdowns" },
    { key: "fantasyPoints", label: "Calculated fantasy" },
    ...(boardMode === "week1" ? [{ key: "prizePicksFantasyScore" as ProjectionColumnKey, label: "PrizePicks fantasy score" }] : []),
    { key: "status", label: "Confidence" },
  ];
  const columnVisible = (key: string) => !hiddenColumns.has(key as ProjectionColumnKey);
  const toggleColumn = (key: string) => {
    const column = key as ProjectionColumnKey;
    const hiding = !hiddenColumns.has(column);
    setHiddenColumns((current) => { const next = new Set(current); if (next.has(column)) next.delete(column); else next.add(column); return next; });
    const sortKey: SortKey = column;
    if (hiding && sort.key === sortKey) setSort({ key: "player", direction: "asc" });
  };
  const visibleColumnCount = 1 + columnChoices.filter((choice) => columnVisible(choice.key)).length;
  const acceptedRuns = snapshot.sourceRuns.filter((run) => run.status === "accepted");
  const reviewCount = snapshot.sourceRuns.filter((run) => run.status !== "accepted").length + (snapshot.issues?.length || 0);
  const isDemo = boardMode === "season" && (snapshot.demo || snapshot.observations.length === 0);
  const changeBoard = (nextBoard: BoardMode) => {
    setBoardMode(nextBoard);
    setPosition("ALL");
    setBook("All sources");
    setQuery("");
    setSelected(null);
    setTrendRange("today");
    setNewPropRange("today");
    setSort({ key: "yards", direction: "desc" });
  };
  const resetAllPlayers = () => {
    setPosition("ALL");
    setBook("All sources");
    setQuery("");
    setSelected(null);
    window.setTimeout(() => document.getElementById("ledger-title")?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  };
  const focusTrend = (move: TrendMove) => {
    setPosition("ALL");
    setBook("All sources");
    setQuery(move.player.name);
    setSelected({ playerId: move.player.id, statType: move.statType, source: move.source });
    window.setTimeout(() => document.getElementById(`ledger-${move.player.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const focusNewProp = (prop: NewProp) => {
    const currentLine = allLines.find((line) => line.id === prop.player.id);
    setPosition("ALL");
    setBook("All sources");
    setQuery(prop.player.name);
    setSelected(currentLine ? { playerId: prop.player.id, statType: prop.statType, source: prop.source } : null);
    window.setTimeout(() => document.getElementById(`ledger-${prop.player.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };

  const siteHeader = <header className="site-header"><a className="brand" href="#top" aria-label="Prop Ledger home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>PROP LEDGER</span></a><div className="header-meta"><span className="live-dot" aria-hidden="true" /><span>{boardMode === "sleeper" ? "Sleeper · redraft ADP" : `${snapshot.season || 2026} NFL · ${boardMode === "season" ? "regular season" : "Week 1"}`}</span></div></header>;
  const boardSwitch = <nav className="board-switch" aria-label="Projection board"><button className={boardMode === "season" ? "active" : ""} aria-pressed={boardMode === "season"} onClick={() => changeBoard("season")}><span>Season</span><strong>Season totals</strong></button><button className={boardMode === "week1" ? "active" : ""} aria-pressed={boardMode === "week1"} onClick={() => changeBoard("week1")}><span>Weekly</span><strong>Week 1 projections</strong></button><button className={boardMode === "sleeper" ? "active" : ""} aria-pressed={boardMode === "sleeper"} onClick={() => changeBoard("sleeper")}><span>Draft</span><strong>Sleeper redraft</strong></button></nav>;
  if (boardMode === "sleeper") return <main>{siteHeader}{boardSwitch}<SleeperRedraftBoardV2 snapshot={sleeperSnapshot} history={sleeperHistory} seasonLines={sleeperSeasonLines} /><footer><span>PROP LEDGER / PERSONAL RESEARCH</span><a href="#top">Back to top ↑</a></footer></main>;

  return <main>
    {siteHeader}
    {boardSwitch}
    <section className="hero" id="top">
      <div><p className="eyebrow">{boardMode === "season" ? "Daily season-long market monitor" : "Weekly matchup projection board"}</p><h1>{boardMode === "season" ? <>Every move.<br /><span>Kept on record.</span></> : <>Week 1.<br /><span>Every source.</span></>}</h1><p className="lede">{boardMode === "season" ? "One clean ledger for QB, RB, WR, and TE season props—validated before each daily change is accepted." : "A separate full-PPR board for QB, RB, WR, and TE Week 1 props—kept completely separate from season-long projections."}</p></div>
      <div className="hero-sidebar"><div className="capture-card" aria-label="Latest capture status"><div className="capture-topline"><span>{boardMode === "season" ? "Latest capture" : "Week 1 capture"}</span><span className="status-pill">{waitingForWeekly ? "Waiting for markets" : isDemo ? "Setup required" : "Double-checked"}</span></div><strong>{waitingForWeekly ? "Board ready" : snapshot.date ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${snapshot.date}T12:00:00Z`)) : "No verified run yet"}</strong><div className="capture-stats"><div><b>{acceptedRuns.length}</b><span>sources accepted</span></div><div><b>{isDemo || waitingForWeekly ? 0 : allLines.length}</b><span>player lines</span></div><div><b>{reviewCount}</b><span>review flags</span></div></div><p>{waitingForWeekly ? "Confirmed Week 1 lines from DraftKings, FanDuel, BetMGM, PrizePicks, and Underdog will appear here; season averages are never substituted." : isDemo ? "The sample rows below demonstrate the layout; they are not current betting lines." : "Only complete, roster-matched, repeat-confirmed sportsbook and projection rows are published."}</p></div></div>
    </section>
    <div className="dashboard-layout">
    <aside className="trend-column" aria-label="Market updates"><NewPropsCard props={newProps} range={newPropRange} onRange={setNewPropRange} onSelect={focusNewProp} /><TrendCard moves={trendMoves} isDemo={isDemo} waitingForWeekly={waitingForWeekly} range={trendRange} onRange={setTrendRange} onSelect={focusTrend} /></aside>
    <section className="ledger" aria-labelledby="ledger-title">
      <div className="ledger-heading"><div><p className="eyebrow">{waitingForWeekly ? "Data-ready board" : isDemo ? "Preview board" : "Verified board"}</p><h2 id="ledger-title">{boardMode === "season" ? "Season totals" : "Week 1 projections"}</h2></div><div className="ledger-tools">{(query || position !== "ALL" || book !== "All sources") && <button className="back-to-all" onClick={resetAllPlayers}>← Back to all players</button>}<label className="search"><span className="sr-only">Search players or teams</span><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player or team" /></label></div></div>
      <div className="filters" aria-label={`Filter ${boardMode === "season" ? "season totals" : "Week 1 projections"}`}><div className="position-tabs" role="group" aria-label="Position">{positions.map((item) => <button key={item} className={position === item ? "active" : ""} onClick={() => setPosition(item)}>{item}</button>)}</div><div className="filter-actions"><button className={`qb-scoring-toggle ${qbPassTdPoints === 6 ? "active" : ""}`} aria-pressed={qbPassTdPoints === 6} onClick={() => setQbPassTdPoints((points) => points === 4 ? 6 : 4)}><span>QB pass TDs</span><strong>{qbPassTdPoints} pts</strong></button><div className="ppr-toggle" role="group" aria-label="Points per reception"><span>PPR</span>{([1, 0.5, 0] as PprScoring[]).map((points) => <button key={points} className={pprScoring === points ? "active" : ""} aria-pressed={pprScoring === points} onClick={() => setPprScoring(points)}>{points.toFixed(1)}</button>)}</div><div className="tep-toggle" role="group" aria-label="Tight end premium"><span>TEP</span>{([0, 0.5, 1] as TePremium[]).map((premium) => <button key={premium} className={tePremium === premium ? "active" : ""} aria-pressed={tePremium === premium} onClick={() => setTePremium(premium)}>{premium.toFixed(1)}</button>)}</div><label className="book-filter"><span>Source</span><select value={book} onChange={(event) => setBook(event.target.value)}>{books.map((item) => <option key={item}>{item}</option>)}</select></label></div></div>
      <div className="table-wrap">
        <table className="projection-table" style={{ minWidth: `${Math.max(620, 240 + (visibleColumnCount - 1) * 190)}px` }}>
          <thead><tr>
            <SortHeader sortKey="player" label="Player" sort={sort} onSort={changeSort} />
            {columnVisible("yards") && <SortHeader sortKey="yards" label="Yards" hint="Passing + rushing + receiving" sort={sort} onSort={changeSort} />}
            {columnVisible("secondary") && <SortHeader sortKey="secondary" label={position === "QB" ? "Rushing yards" : position === "ALL" ? "Receptions / QB rush yards" : "Receptions"} hint="When offered" sort={sort} onSort={changeSort} />}
            {columnVisible("touchdowns") && <SortHeader sortKey="touchdowns" label={boardMode === "week1" ? "TD chance" : "Touchdowns"} hint={boardMode === "week1" ? "Any rushing or receiving TD" : "Passing + rushing + receiving"} sort={sort} onSort={changeSort} />}
            {columnVisible("fantasyPoints") && <SortHeader sortKey="fantasyPoints" label="Calculated fantasy" hint={`${pprScoring.toFixed(1)} PPR · TEP ${tePremium.toFixed(1)} · ${boardMode === "season" ? "season" : "Week 1"}`} sort={sort} onSort={changeSort} />}
            {boardMode === "week1" && columnVisible("prizePicksFantasyScore") && <SortHeader sortKey="prizePicksFantasyScore" label="PrizePicks fantasy score" hint="Posted projection" sort={sort} onSort={changeSort} />}
            {columnVisible("status") && <SortHeader sortKey="status" label="Confidence" hint="Coverage + completeness" sort={sort} onSort={changeSort} />}
          </tr></thead>
          <tbody>{lines.map((line) => {
            const expanded = selected?.playerId === line.id;
            const positionRank = positionRanks.get(line.id);
            const hasCompleteProjection = rankableFantasyPoints(line, qbPassTdPoints, tePremium, pprScoring) !== null;
            const extraYards = line.position === "QB" ? [] : line.position === "RB" ? [{ cell: line.receivingYards, label: "Rec yds" }] : [{ cell: visibleOptionalRushingYards(line), label: "Rush yds" }];
            const inspect = (statType: StatType) => setSelected({ playerId: line.id, statType });
            return <Fragment key={line.id}>
              <tr className={`data-row ${expanded ? "expanded" : ""}`}>
                <td><div className="player-cell"><span className={`position position-${line.position.toLowerCase()}`}>{line.position}</span><div><span className="player-name-row"><strong>{line.player}</strong>{hasCompleteProjection && positionRank ? <span className="projection-rank ranked" title={`${line.position}${positionRank} in ${boardMode === "season" ? "season" : "Week 1"} projection order by verified calculated fantasy points`}>{line.position}{positionRank}</span> : <span className="projection-rank incomplete" title="Not ranked; verified fantasy inputs are incomplete">NR</span>}</span><span>{line.team}</span><button className="ledger-link" aria-expanded={expanded && selected?.statType === null} aria-controls={`ledger-${line.id}`} onClick={() => setSelected(expanded && selected?.statType === null ? null : { playerId: line.id, statType: null })}>{expanded && selected?.statType === null ? "Hide ledger" : "View ledger"}</button></div></div></td>
                {columnVisible("yards") && <td><StatStack entries={[{ cell: line.yards, label: line.yardLabel }, ...extraYards]} preferredSource={line.source} player={line.player} onInspect={inspect} /></td>}
                {columnVisible("secondary") && <td><LineCell cell={line.position === "QB" ? line.rushingYards : line.receptions} label={line.position === "QB" ? "Rush yds" : "Receptions"} preferredSource={line.source} player={line.player} onInspect={inspect} /></td>}
                {columnVisible("touchdowns") && <td>{boardMode === "week1" ? <TouchdownChanceCell line={line} onInspect={inspect} /> : <SeasonTouchdownCell line={line} onInspect={inspect} />}</td>}
                {columnVisible("fantasyPoints") && <td><FantasyCell line={line} qbPassTdPoints={qbPassTdPoints} tePremium={tePremium} pprScoring={pprScoring} /></td>}
                {boardMode === "week1" && columnVisible("prizePicksFantasyScore") && <td><LineCell cell={line.prizePicksFantasyScore} label="PrizePicks" preferredSource="prizepicks" player={line.player} onInspect={inspect} /></td>}
                {columnVisible("status") && <td><span className={`confidence ${line.confidence}`}><i aria-hidden="true" />{line.confidence[0].toUpperCase() + line.confidence.slice(1)}</span><small>{line.confidenceNote}</small><small className={`verification-note ${line.status}`}>{line.status === "verified" ? "Verified" : "Review"} · {line.verifiedAt}</small></td>}
              </tr>
              {expanded && selected?.statType === null && <tr className="history-row"><td colSpan={visibleColumnCount}><PlayerLedger line={line} history={history} onClose={() => setSelected(null)} /></td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
        {lines.length === 0 && <div className={`empty-state ${waitingForWeekly ? "weekly-waiting" : ""}`}>{waitingForWeekly ? <><strong>Week 1 board is ready.</strong><span>Player projections will appear after the first confirmed Week 1 markets are captured from DraftKings, FanDuel, BetMGM, PrizePicks, or Underdog.</span></> : "No players match these filters."}</div>}
      </div>
    </section>
    </div>
    {activePropLine && selected?.statType && <div className="graph-drawer-layer"><button className="graph-drawer-scrim" aria-label="Close line trend drawer" onClick={() => setSelected(null)} /><aside className="graph-drawer" role="dialog" aria-modal="true" aria-label={`${activePropLine.player} ${STAT_LABELS[selected.statType]} line trend`}><PropComparison line={activePropLine} statType={selected.statType} history={history} movements={snapshot.movements || []} highlightedSource={selected.source} onBackAll={resetAllPlayers} onClose={() => setSelected(null)} /></aside></div>}
    <ColumnChooser choices={columnChoices} isVisible={columnVisible} onToggle={toggleColumn} onShowAll={() => setHiddenColumns(new Set())} />
    <footer><span>PROP LEDGER / PERSONAL RESEARCH</span><a href="https://github.com/nflverse/nflverse-data/releases/tag/stats_player" target="_blank" rel="noreferrer">Prior-season stats: FTN Data via nflverse ↗</a><span>Lines are observations, not betting advice.</span></footer>
  </main>;
}
