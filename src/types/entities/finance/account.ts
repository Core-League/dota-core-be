import { z } from 'zod';

/**
 * Local mirror of a Bank account (from `client-info`). `balance` is the
 * authoritative balance in **kopecks**; `id` is the Bank account id.
 */
export const StoredAccountSchema = z.object({
  id: z.string(),
  maskedPan: z.array(z.string()).default([]),
  balance: z.number().int(),
  currencyCode: z.number().int(),
  type: z.string(),
});

export type StoredAccount = z.infer<typeof StoredAccountSchema>;
