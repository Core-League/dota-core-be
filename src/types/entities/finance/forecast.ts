import { z } from 'zod';

/**
 * Forecast calculator input. All money is in **kopecks**.
 *
 * - `divisions` — exactly three divisions, each with its team count and the
 *   project's own contribution to that division's prize pool.
 * - `fees` — per-player entry fee by placement bracket (defaults 100/150/200 UAH
 *   → kopecks; a team is 5 players).
 * - `prizePoolPercent` — share of everything collected that goes to prizes
 *   (default 60); the remainder is projected profit.
 */
export const ForecastDivisionSchema = z.object({
  teamCount: z.number().int().nonnegative(),
  projectContribution: z.number().int().nonnegative(),
});

export const ForecastFeesSchema = z.object({
  top1_4: z.number().int().nonnegative(),
  top5_8: z.number().int().nonnegative(),
  top8plus: z.number().int().nonnegative(),
});

export const ForecastConfigSchema = z.object({
  divisions: z.tuple([
    ForecastDivisionSchema,
    ForecastDivisionSchema,
    ForecastDivisionSchema,
  ]),
  fees: ForecastFeesSchema,
  prizePoolPercent: z.number().int().min(0).max(100).default(60),
});

export type ForecastDivision = z.infer<typeof ForecastDivisionSchema>;
export type ForecastFees = z.infer<typeof ForecastFeesSchema>;
export type ForecastConfig = z.infer<typeof ForecastConfigSchema>;

/**
 * Forecast calculator output. Per-division `collected` is fees gathered;
 * `prizePool` is the project contribution plus this division's share of the
 * total pool, floored **down to hundreds** (of UAH). Totals are summed across
 * divisions. `projectedProfit = totalCollected * (100 − prizePoolPercent)%`.
 */
export const ForecastDivisionResultSchema = z.object({
  collected: z.number().int(),
  prizePool: z.number().int(),
});

export const ForecastResultSchema = z.object({
  divisions: z.tuple([
    ForecastDivisionResultSchema,
    ForecastDivisionResultSchema,
    ForecastDivisionResultSchema,
  ]),
  totalCollected: z.number().int(),
  totalPrizePool: z.number().int(),
  projectedExpenses: z.number().int(),
  projectedProfit: z.number().int(),
});

export type ForecastDivisionResult = z.infer<
  typeof ForecastDivisionResultSchema
>;
export type ForecastResult = z.infer<typeof ForecastResultSchema>;
