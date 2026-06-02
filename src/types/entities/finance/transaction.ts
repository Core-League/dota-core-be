import { z } from 'zod';

/**
 * A persisted raw bank transaction — the stored subset of the Bank API
 * `StatementItem` (`types/entities/bank.ts`). Immutable source of truth;
 * `id` is the Bank transaction id, so the same item from a webhook and a
 * statement de-dupes to one row. Money is in **kopecks**, signed
 * (`+` income / `−` expense).
 */
export const StoredTransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  time: z.date(),
  amount: z.number().int(),
  description: z.string(),
  comment: z.string().optional(),
  mcc: z.number().int(),
  counterIban: z.string().optional(),
  counterEdrpou: z.string().optional(),
  balance: z.number().int(),
  hold: z.boolean(),
  currencyCode: z.number().int(),
});

export type StoredTransaction = z.infer<typeof StoredTransactionSchema>;
