export const ACTIVE_CAPTURE_SOURCES = Object.freeze(["prizepicks", "fanduel", "underdog"]);

export const SEASON_SOURCES = new Set(["prizepicks"]);
export const WEEK_ONE_SOURCES = new Set(["fanduel", "prizepicks", "underdog"]);

export function sourceAllowedForScope(source, scope) {
  if (scope === "regular_season") return SEASON_SOURCES.has(source);
  if (scope === "week_1") return WEEK_ONE_SOURCES.has(source);
  return false;
}

export function observationAllowedBySourcePolicy(observation) {
  return sourceAllowedForScope(observation?.source, observation?.marketScope || "regular_season");
}
