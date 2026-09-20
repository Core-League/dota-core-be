import { z } from 'zod';

/**
 * Zod models for the Bank Personal API (https://api.monobank.ua). Monetary fields
 * stay in **kopecks** (signed: + income / − expense); UAH conversion and
 * classification belong to the business layer.
 */

/** A single account from `client-info` (`Account`). */
export const AccountSchema = z.object({
  id: z.string(),
  sendId: z.string().optional(),
  balance: z.number(),
  creditLimit: z.number(),
  currencyCode: z.number(),
  cashbackType: z.string().optional(),
  maskedPan: z.array(z.string()).default([]),
  type: z.string(),
  iban: z.string().optional(),
});

export type Account = z.infer<typeof AccountSchema>;

/**
 * A single jar (банка) from `client-info`. Note `id` and `sendId` are different
 * values and are NOT derivable from each other: `sendId` is what appears in the
 * public `https://send.monobank.ua/{sendId}` link, while `id` is what arrives as
 * `data.account` in a webhook push and what `getStatement` accepts. Mapping one
 * to the other requires this endpoint.
 */
export const JarSchema = z.object({
  id: z.string(),
  sendId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  currencyCode: z.number(),
  balance: z.number(),
  goal: z.number().nullable().optional(),
});

export type Jar = z.infer<typeof JarSchema>;

/**
 * A single operation — identical shape in a statement and in a webhook push
 * (`StatementItem`). Amounts are in kopecks.
 */
export const TransactionSchema = z.object({
  id: z.string(),
  time: z.number(),
  description: z.string(),
  mcc: z.number(),
  originalMcc: z.number(),
  hold: z.boolean(),
  amount: z.number(),
  operationAmount: z.number(),
  currencyCode: z.number(),
  commissionRate: z.number(),
  cashbackAmount: z.number(),
  balance: z.number(),
  comment: z.string().optional(),
  receiptId: z.string().optional(),
  invoiceId: z.string().optional(),
  counterEdrpou: z.string().optional(),
  counterIban: z.string().optional(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

/** Response of `GET /personal/client-info`. */
export const ClientInfoSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  webHookUrl: z.string().optional(),
  permissions: z.string().optional(),
  accounts: z.array(AccountSchema),
  // Absent for tokens without jar access — default so those clients still parse.
  jars: z.array(JarSchema).default([]),
});

export type ClientInfo = z.infer<typeof ClientInfoSchema>;

/**
 * Body Bank pushes to the registered webhook URL. `type` is always
 * `"StatementItem"`; reject anything else.
 */
export const WebhookPayloadSchema = z.object({
  type: z.literal('StatementItem'),
  data: z.object({
    account: z.string(),
    statementItem: TransactionSchema,
  }),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
