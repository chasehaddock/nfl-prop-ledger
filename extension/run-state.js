export const RUN_LEASE_MS = 20 * 60 * 1000;

export function isRunLeaseActive(state, now = Date.now()) {
  if (state?.running !== true || !Number.isFinite(state?.runningSince)) return false;
  const age = now - state.runningSince;
  return age >= 0 && age < RUN_LEASE_MS;
}

export function filterActiveFailedSourceIds(failedSourceIds, activeSourceIds) {
  if (!Array.isArray(failedSourceIds) || !Array.isArray(activeSourceIds)) return [];
  const activeIds = new Set(activeSourceIds);
  return [...new Set(failedSourceIds.filter((sourceId) => activeIds.has(sourceId)))];
}
