const TRANSIENT_CODES = new Set(["EAGAIN", "EBUSY", "EMFILE", "ENFILE", "ETIMEDOUT"]);

export function isTransientFailure(error) {
  const detail = [error?.code, error?.errno, error?.message, error?.stderr].filter(Boolean).join(" ");
  return TRANSIENT_CODES.has(error?.code) || error?.errno === -11 || /Unknown system error -11|resource temporarily unavailable/i.test(detail);
}

export async function retryTransient(operation, { attempts = 5, delayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientFailure(error) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

export function previousSnapshotFilename(filenames, date) {
  const currentFilename = `${date}.json`;
  return filenames
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name < currentFilename)
    .sort()
    .at(-1) || null;
}

function localParts(timestamp, timeZone) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
    timestamp: date.getTime(),
  };
}

export function calendarDateInTimeZone(timestamp, timeZone = "America/Chicago") {
  return localParts(timestamp, timeZone)?.date || null;
}

export function validateDailyRawPair(primary, confirmation, {
  source,
  date,
  now = new Date(),
  timeZone = "America/Chicago",
  earliestMinute = 7 * 60 + 30,
  maximumPairGapMs = 45 * 60 * 1000,
} = {}) {
  const errors = [];
  if (primary?.source !== source || confirmation?.source !== source) errors.push("source does not match the expected sportsbook");
  if (!Number.isInteger(primary?.season) || primary.season !== confirmation?.season) errors.push("primary and confirmation seasons do not match");
  if (!Array.isArray(primary?.pages) || !primary.pages.length || !Array.isArray(confirmation?.pages) || !confirmation.pages.length) errors.push("primary and confirmation pages must be present");

  const primaryTime = localParts(primary?.capturedAt, timeZone);
  const confirmationTime = localParts(confirmation?.capturedAt, timeZone);
  if (!primaryTime || !confirmationTime) return [...errors, "capture timestamps are invalid"];
  if (primaryTime.date !== date || confirmationTime.date !== date) errors.push(`capture is not from local date ${date}`);
  if (primaryTime.minuteOfDay < earliestMinute || confirmationTime.minuteOfDay < earliestMinute) errors.push("capture predates today's scheduled run window");
  const pairGap = confirmationTime.timestamp - primaryTime.timestamp;
  if (pairGap < 0 || pairGap > maximumPairGapMs) errors.push("primary and confirmation are outside the allowed capture window");
  if (confirmationTime.timestamp > now.getTime() + 5 * 60 * 1000) errors.push("capture timestamp is in the future");
  return errors;
}
