/** Length of one verification step / calendar slot, in minutes. */
export const SLOT_MINUTES = 30;

/** Minimum verified team members above which single-player requests are allowed. */
export const ESTABLISHED_TEAM_VERIFIED_COUNT = 3;

/**
 * UTC `[start, end)` day bounds for a `YYYY-MM-DD` string, or for the current
 * day when omitted. All verification time handling is UTC (see plan).
 */
export function utcDayRange(date?: string): { start: Date; end: Date } {
  const base = date ? new Date(`${date}T00:00:00.000Z`) : new Date();
  const start = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
