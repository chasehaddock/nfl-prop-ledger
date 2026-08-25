export type FantasyPosition = "QB" | "RB" | "WR" | "TE";
export type FantasyStat = "passing_yards" | "passing_touchdowns" | "rushing_yards" | "rushing_touchdowns" | "receiving_yards" | "receiving_touchdowns" | "offensive_touchdowns" | "receptions" | "fantasy_score";
export type FantasyLines = Partial<Record<FantasyStat, number>>;

export function requiredFantasyStats(position: FantasyPosition): FantasyStat[] {
  if (position === "QB") return ["passing_yards", "passing_touchdowns"];
  if (position === "RB") return ["rushing_yards", "receptions", "rushing_touchdowns"];
  return ["receiving_yards", "receptions", "receiving_touchdowns"];
}

export function americanImpliedProbability(odds: number): number {
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
}

export function fairOverProbability(overOdds: number, underOdds: number): number {
  const over = americanImpliedProbability(overOdds);
  const under = americanImpliedProbability(underOdds);
  const halfOverround = (over + under - 1) / 2;
  return Math.max(0, Math.min(1, over - halfOverround));
}

export function lineCenteredExpectation(line: number, fairOver: number): number {
  if (!Number.isFinite(line) || line < 0 || !Number.isFinite(fairOver) || fairOver < 0 || fairOver > 1) return Number.NaN;
  return Math.max(0, line + fairOver - 0.5);
}

export function combineTouchdownProbabilities(...probabilities: number[]): number {
  const valid = probabilities.filter((probability) => Number.isFinite(probability) && probability >= 0 && probability <= 1);
  return 1 - valid.reduce((none, probability) => none * (1 - probability), 1);
}

export function calculateFantasyPoints(position: FantasyPosition, lines: FantasyLines): number | null {
  const required = requiredFantasyStats(position);
  const missing = required.filter((stat) => !Number.isFinite(lines[stat]));
  const touchdownAlternative = Number.isFinite(lines.offensive_touchdowns);
  if (missing.some((stat) => !touchdownAlternative || !["rushing_touchdowns", "receiving_touchdowns"].includes(stat))) return null;

  if (position === "QB") {
    const offensiveTouchdowns = lines.offensive_touchdowns ?? lines.rushing_touchdowns ?? 0;
    return lines.passing_yards! / 25
      + lines.passing_touchdowns! * 4
      + (lines.rushing_yards || 0) / 10
      + offensiveTouchdowns * 6;
  }
  if (position === "RB") {
    const offensiveTouchdowns = lines.offensive_touchdowns ?? ((lines.rushing_touchdowns || 0) + (lines.receiving_touchdowns || 0));
    return lines.rushing_yards! / 10
      + lines.receptions!
      + (lines.receiving_yards || 0) / 10
      + offensiveTouchdowns * 6;
  }
  const offensiveTouchdowns = lines.offensive_touchdowns ?? ((lines.receiving_touchdowns || 0) + (lines.rushing_touchdowns || 0));
  return lines.receiving_yards! / 10
    + lines.receptions!
    + (lines.rushing_yards || 0) / 10
    + offensiveTouchdowns * 6;
}
