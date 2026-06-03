import { z } from 'zod';

/**
 * Account balance in **kopecks**. `actual` is the authoritative balance from the
 * account mirror (Bank `client-info`); when forecast is requested, `forecast`
 * holds the projected delta and `total` = `actual + forecast`. Without forecast,
 * `forecast` is 0 and `total` equals `actual`.
 */
export const BalanceSchema = z.object({
  actual: z.number().int(),
  forecast: z.number().int(),
  total: z.number().int(),
  includesForecast: z.boolean(),
});

export type Balance = z.infer<typeof BalanceSchema>;
