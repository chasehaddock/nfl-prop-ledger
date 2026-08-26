import { createHash } from "node:crypto";

export const SUPPORTED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
export const SUPPORTED_STATS = new Set([
  "passing_yards",
  "passing_touchdowns",
  "interceptions",
  "rushing_yards",
  "rushing_touchdowns",
  "offensive_touchdowns",
  "receiving_yards",
  "receiving_touchdowns",
  "receptions",
  "fantasy_score",
]);

const SEASON_STAT_RANGES = {
  passing_yards: [0.5, 6500.5],
  passing_touchdowns: [0.5, 70.5],
  interceptions: [0.5, 40.5],
  rushing_yards: [0.5, 3000.5],
  rushing_touchdowns: [0.5, 40.5],
  offensive_touchdowns: [0.5, 40.5],
  receiving_yards: [0.5, 3000.5],
  receiving_touchdowns: [0.5, 40.5],
  receptions: [0.5, 250.5],
  fantasy_score: [0.5, 750.5],
};

const WEEKLY_STAT_RANGES = {
  passing_yards: [0.5, 600.5],
  passing_touchdowns: [0.5, 7.5],
  interceptions: [0.5, 5.5],
  rushing_yards: [0.5, 300.5],
  rushing_touchdowns: [0.5, 4.5],
  offensive_touchdowns: [0.5, 4.5],
  receiving_yards: [0.5, 300.5],
  receiving_touchdowns: [0.5, 4.5],
  receptions: [0.5, 25.5],
  fantasy_score: [0.5, 100.5],
};

export function normalizeName(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function playerId(player) {
  return player.id || normalizeName(player.name).replace(/\s+/g, "-");
}

export function marketKey(observation) {
  return [
    observation.season,
    observation.source,
    playerId(observation.player),
    observation.marketScope || "regular_season",
    observation.statType,
  ].join(":");
}

export function fingerprint(observation) {
  return createHash("sha256")
    .update(JSON.stringify({
      key: marketKey(observation),
      line: observation.line,
      overOdds: observation.overOdds ?? null,
      underOdds: observation.underOdds ?? null,
      higherMultiplier: observation.higherMultiplier ?? null,
      lowerMultiplier: observation.lowerMultiplier ?? null,
    }))
    .digest("hex");
}

export function americanImpliedProbability(odds) {
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

export function fairOverProbability(overOdds, underOdds) {
  const over = americanImpliedProbability(overOdds);
  const under = americanImpliedProbability(underOdds);
  return over / (over + under);
}

function validateAmericanOdds(value) {
  return Number.isInteger(value) && Math.abs(value) >= 100 && Math.abs(value) <= 10000;
}

function validateMultiplier(value) {
  return Number.isFinite(value) && value >= 0.25 && value <= 10;
}

export function validateObservation(observation, providerType = "sportsbook") {
  const errors = [];
  if (!observation || typeof observation !== "object") return ["observation must be an object"];
  if (!observation.source) errors.push("source is required");
  if (!Number.isInteger(observation.season)) errors.push("season must be an integer");
  if (!observation.player?.name?.trim()) errors.push("player.name is required");
  if (!SUPPORTED_POSITIONS.has(observation.player?.position)) errors.push("player.position is unsupported");
  if (!SUPPORTED_STATS.has(observation.statType)) errors.push("statType is unsupported");
  if (!["regular_season", "week_1"].includes(observation.marketScope)) errors.push("marketScope must be regular_season or week_1");
  if (!Number.isFinite(observation.line)) errors.push("line must be numeric");

  const range = (observation.marketScope === "week_1" ? WEEKLY_STAT_RANGES : SEASON_STAT_RANGES)[observation.statType];
  if (range && Number.isFinite(observation.line) && (observation.line < range[0] || observation.line > range[1])) {
    errors.push(`line is outside the safety range for ${observation.statType}`);
  }

  if (providerType === "sportsbook") {
    if (!validateAmericanOdds(observation.overOdds)) errors.push("overOdds must be valid American odds");
    const permitsOneSidedAnyTouchdown = observation.marketScope === "week_1"
      && observation.statType === "offensive_touchdowns"
      && observation.underOdds === undefined;
    if (!permitsOneSidedAnyTouchdown && !validateAmericanOdds(observation.underOdds)) errors.push("underOdds must be valid American odds");
  }
  if (providerType === "multiplier") {
    if (observation.marketScope !== "week_1") errors.push("multiplier markets must be Week 1");
    if (!["passing_touchdowns", "offensive_touchdowns"].includes(observation.statType)) errors.push("multiplier market statType is unsupported");
    if (!validateMultiplier(observation.higherMultiplier)) errors.push("higherMultiplier must be valid");
    if (!validateMultiplier(observation.lowerMultiplier)) errors.push("lowerMultiplier must be valid");
  }

  if (!observation.sourceUrl?.startsWith("https://")) errors.push("sourceUrl must be an https URL");
  if (!observation.evidenceHash || observation.evidenceHash.length < 16) errors.push("evidenceHash is required");
  return errors;
}

export function selectMainLines(observations, providerType = "sportsbook") {
  const groups = new Map();
  for (const observation of observations) {
    const key = marketKey(observation);
    const group = groups.get(key) || [];
    group.push(observation);
    groups.set(key, group);
  }

  const selected = [];
  const errors = [];
  for (const [key, candidates] of groups) {
    if (candidates.length === 1) {
      selected.push({ ...candidates[0], selectionMethod: candidates[0].isMain ? "book_marker" : "only_line" });
      continue;
    }

    const markedMain = candidates.filter((candidate) => candidate.isMain === true);
    if (markedMain.length === 1) {
      selected.push({ ...markedMain[0], selectionMethod: "book_marker" });
      continue;
    }
    if (markedMain.length > 1) {
      errors.push(`${key}: multiple lines are marked main`);
      continue;
    }
    if (providerType !== "sportsbook") {
      errors.push(`${key}: multiple projection lines are ambiguous`);
      continue;
    }

    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: Math.abs((validateAmericanOdds(candidate.underOdds)
          ? fairOverProbability(candidate.overOdds, candidate.underOdds)
          : americanImpliedProbability(candidate.overOdds)) - 0.5),
      }))
      .sort((a, b) => a.score - b.score);

    if (ranked[1] && Math.abs(ranked[0].score - ranked[1].score) < 0.000001) {
      errors.push(`${key}: two candidate lines are equally balanced`);
      continue;
    }
    selected.push({ ...ranked[0].candidate, selectionMethod: "price_balance" });
  }
  return { selected, errors };
}

export function validateCapture(capture) {
  const errors = [];
  if (!capture?.source) errors.push("capture.source is required");
  if (!Number.isInteger(capture?.season)) errors.push("capture.season must be an integer");
  if (!capture?.capturedAt || Number.isNaN(Date.parse(capture.capturedAt))) errors.push("capture.capturedAt must be an ISO timestamp");
  if (capture?.complete !== true) errors.push("capture is not complete");
  if (!Array.isArray(capture?.observations) || capture.observations.length === 0) errors.push("capture has no observations");

  if (Array.isArray(capture?.observations)) {
    capture.observations.forEach((observation, index) => {
      if (observation.source !== capture.source) errors.push(`observation ${index}: source does not match capture`);
      if (observation.season !== capture.season) errors.push(`observation ${index}: season does not match capture`);
      for (const error of validateObservation(observation, capture.providerType)) {
        errors.push(`observation ${index}: ${error}`);
      }
    });
  }
  return errors;
}

export function confirmCapturePair(primary, confirmation) {
  const primaryErrors = validateCapture(primary);
  const confirmationErrors = validateCapture(confirmation);
  if (primaryErrors.length || confirmationErrors.length) {
    return { capture: null, errors: [...primaryErrors, ...confirmationErrors] };
  }
  if (primary.source !== confirmation.source || primary.season !== confirmation.season) {
    return { capture: null, errors: ["confirmation capture does not match source and season"] };
  }

  const primarySelection = selectMainLines(primary.observations, primary.providerType);
  const confirmationSelection = selectMainLines(confirmation.observations, confirmation.providerType);
  const errors = [...primarySelection.errors, ...confirmationSelection.errors];
  const confirmationByKey = new Map(confirmationSelection.selected.map((item) => [marketKey(item), item]));
  const observations = primarySelection.selected.map((item) => {
    const repeated = confirmationByKey.get(marketKey(item));
    return { ...item, confirmed: repeated ? fingerprint(repeated) === fingerprint(item) : false };
  });

  return {
    errors,
    capture: {
      ...primary,
      capturedAt: confirmation.capturedAt,
      observations,
      confirmationEvidenceHash: confirmation.evidenceHash,
    },
  };
}

function oddsChanged(current, previous) {
  return current.overOdds !== previous.overOdds
    || current.underOdds !== previous.underOdds
    || current.higherMultiplier !== previous.higherMultiplier
    || current.lowerMultiplier !== previous.lowerMultiplier;
}

function changeType(current, previous) {
  if (!previous) return "opened";
  if (["not_seen", "removed"].includes(previous.status)) return "restored";
  if (current.line > previous.line) return "line_increased";
  if (current.line < previous.line) return "line_decreased";
  if (oddsChanged(current, previous)) return "odds_changed";
  return "unchanged";
}

function carryForward(previous, status, date) {
  return {
    ...previous,
    date,
    status,
    missingDays: status === "stale" ? previous.missingDays || 0 : (previous.missingDays || 0) + 1,
    changeType: status,
    lineDelta: 0,
  };
}

export function buildDailySnapshot({ date, season, captures, previousSnapshot = null, minimumCountRatio = 0.65 }) {
  const previousObservations = previousSnapshot?.observations || [];
  const previousByKey = new Map(previousObservations.map((item) => [item.key, item]));
  const previousBySource = Map.groupBy(previousObservations, (item) => item.source);
  const observations = [];
  const sourceRuns = [];
  const issues = [];
  const captureSources = new Set(captures.map((capture) => capture.source));

  for (const capture of captures) {
    const validationErrors = validateCapture(capture);
    const selection = validationErrors.length
      ? { selected: [], errors: [] }
      : selectMainLines(capture.observations, capture.providerType);
    const unconfirmed = selection.selected.filter((item) => item.confirmed !== true);
    const previousSource = previousBySource.get(capture.source) || [];
    const activePrevious = previousSource.filter((item) => item.status !== "removed");
    const abnormalDrop = activePrevious.length >= 5 && selection.selected.length < activePrevious.length * minimumCountRatio;
    const captureIssues = [
      ...validationErrors,
      ...selection.errors,
      ...unconfirmed.map((item) => `${marketKey(item)}: confirmation did not match`),
      ...(abnormalDrop ? [`market count fell from ${activePrevious.length} to ${selection.selected.length}`] : []),
    ];

    if (captureIssues.length) {
      issues.push(...captureIssues.map((issue) => `${capture.source}: ${issue}`));
      sourceRuns.push({ source: capture.source, status: "rejected", capturedAt: capture.capturedAt, issues: captureIssues });
      observations.push(...previousSource.map((item) => carryForward(item, "stale", date)));
      continue;
    }

    const seen = new Set();
    for (const item of selection.selected) {
      const key = marketKey(item);
      const previous = previousByKey.get(key);
      seen.add(key);
      observations.push({
        ...item,
        key,
        date,
        status: "open",
        missingDays: 0,
        previousLine: previous?.line ?? null,
        lineDelta: previous ? item.line - previous.line : null,
        changeType: changeType(item, previous),
      });
    }

    for (const previous of previousSource) {
      if (seen.has(previous.key)) continue;
      const nextMissingDays = (previous.missingDays || 0) + 1;
      const status = nextMissingDays >= 2 ? "removed" : "not_seen";
      observations.push(carryForward(previous, status, date));
    }
    sourceRuns.push({ source: capture.source, status: "accepted", capturedAt: capture.capturedAt, observationCount: selection.selected.length });
  }

  for (const [source, previousSource] of previousBySource) {
    if (captureSources.has(source)) continue;
    sourceRuns.push({ source, status: "not_run", issues: ["no capture supplied"] });
    observations.push(...previousSource.map((item) => carryForward(item, "stale", date)));
  }

  return {
    schemaVersion: 1,
    date,
    season,
    generatedAt: new Date().toISOString(),
    sourceRuns,
    observations: observations.sort((a, b) => a.source.localeCompare(b.source) || b.line - a.line),
    issues,
  };
}
