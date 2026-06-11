import { BadRequestException } from '@nestjs/common';

/** Length of one verification step / calendar slot, in minutes. */
export const SLOT_MINUTES = 30;

/** Minimum verified team members above which single-player requests are allowed. */
export const ESTABLISHED_TEAM_VERIFIED_COUNT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start-of-UTC-day for a `YYYY-MM-DD` string (throws on a bad value). */
function startOfUtcDay(date: string): Date {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid date: ${date}`);
  }
  return parsed;
}

/**
 * UTC `[start, end)` bounds covering the inclusive `from`..`to` day range
 * (`YYYY-MM-DD`). Both default to the current UTC day, so an omitted range is
 * just today; `to` is inclusive, so its whole day is covered. All verification
 * time handling is UTC (see plan).
 */
export function utcDateRange(
  from?: string,
  to?: string,
): { start: Date; end: Date } {
  const today = new Date().toISOString().slice(0, 10);
  const start = startOfUtcDay(from ?? today);
  const end = new Date(startOfUtcDay(to ?? from ?? today).getTime() + DAY_MS);
  if (end <= start) {
    throw new BadRequestException('`to` must not be before `from`');
  }
  return { start, end };
}
