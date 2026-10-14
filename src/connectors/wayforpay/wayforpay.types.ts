import { z } from 'zod';
import type { TInvoiceStatus } from '../../tournaments/tournament-payment-transition';

/** regularApi success; every other code is a refusal. */
export const WFP_REGULAR_OK = 4100;

/** regularApi: no such rule / completed / removed — the subscription is already gone at WayForPay. */
export const WFP_REGULAR_GONE: readonly number[] = [4102, 4106, 4107];

/** CHECK_STATUS reasonCode of an order WayForPay has no payment for yet. */
export const WFP_ORDER_NOT_FOUND = 1127;

/**
 * A transaction as the serviceUrl callback and CHECK_STATUS report it.
 * Permissive about fields we do not act on — a new field from WayForPay must
 * not turn a real payment into a parse failure.
 */
export const WfpTransactionSchema = z
  .object({
    merchantAccount: z.string().optional(),
    orderReference: z.string().min(1),
    merchantSignature: z.string().optional(),
    amount: z.union([z.number(), z.string()]).optional(),
    currency: z.string().optional(),
    authCode: z.union([z.string(), z.number()]).nullish(),
    cardPan: z.string().nullish(),
    transactionStatus: z.string().optional(),
    reason: z.union([z.string(), z.number()]).nullish(),
    reasonCode: z.union([z.number(), z.string()]).nullish(),
    recToken: z.string().nullish(),
    processingDate: z.union([z.number(), z.string()]).nullish(),
    createdDate: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough();

export type TWfpTransaction = z.infer<typeof WfpTransactionSchema>;

/** regularApi answer (STATUS fills the schedule fields; the others only reasonCode / reason). */
export const WfpRegularSchema = z
  .object({
    reasonCode: z.union([z.number(), z.string()]),
    reason: z.union([z.string(), z.number()]).nullish(),
    status: z.string().nullish(),
    mode: z.string().nullish(),
    amount: z.union([z.number(), z.string()]).nullish(),
    currency: z.string().nullish(),
    card: z.string().nullish(),
    dateBegin: z.union([z.number(), z.string()]).nullish(),
    dateEnd: z.union([z.number(), z.string()]).nullish(),
    lastPayedDate: z.union([z.number(), z.string()]).nullish(),
    lastPayedStatus: z.string().nullish(),
    nextPaymentDate: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough();

export type TWfpRegular = z.infer<typeof WfpRegularSchema>;

export type TWfpRegularRequest = 'STATUS' | 'SUSPEND' | 'RESUME' | 'REMOVE';

export type TWfpPurchaseParams = {
  orderReference: string;
  /** Kopecks. Every Core League payment is in UAH. */
  amount: number;
  /** Shown on the payment page. */
  productName: string;
  /** This API's callback URL. */
  serviceUrl: string;
  /** Where the payer lands after paying. */
  returnUrl: string;
  /** Seconds the page stays payable. */
  lifetimeSec: number;
  clientAccountId?: string;
  /**
   * Turns the purchase into a monthly regular payment (VIP): WayForPay charges
   * the same amount on `dateNext`, then every month until `dateEnd`.
   */
  regular?: { dateNext: Date; dateEnd: Date };
};

/**
 * `<reference>_<expiry, unix seconds in base 36>`: every WayForPay page gets
 * its own order (an order reference can be paid only once), while the row's
 * own reference stays recoverable for callbacks and the page's lifetime stays
 * readable without a column. References are `[A-Z0-9-]`, so `_` is free.
 */
export function wfpOrderReference(reference: string, expiresAt: Date): string {
  return `${reference}_${Math.floor(expiresAt.getTime() / 1000)
    .toString(36)
    .toUpperCase()}`;
}

/** The reference and page expiry inside an order reference; null when it is not one of ours. */
export function parseWfpOrderReference(
  orderReference: string,
): { reference: string; expiresAt: Date } | null {
  const match = /^([A-Z0-9-]+)_([0-9A-Z]+)$/.exec(orderReference);
  if (!match) return null;
  const seconds = parseInt(match[2], 36);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { reference: match[1], expiresAt: new Date(seconds * 1000) };
}

/** "200" / "180" / "4.99": the amount exactly as sent, so the signed string and the field agree. */
export function formatWfpAmount(kopecks: number): string {
  return (kopecks / 100).toFixed(2).replace(/\.?0+$/, '');
}

/** A WayForPay amount (hryvnias, number or string) in kopecks; null when absent. */
export function wfpAmountToKopecks(
  amount: number | string | null | undefined,
): number | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** DD.MM.YYYY in Kyiv time (WayForPay's dateNext / dateEnd). */
export function wfpDate(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part('day')}.${part('month')}.${part('year')}`;
}

/** A WayForPay timestamp (unix seconds, number or string) as a Date; null when absent or unreadable. */
export function wfpTime(
  value: number | string | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const n =
    typeof value === 'number'
      ? value
      : /^\d+$/.test(value)
        ? Number(value)
        : Date.parse(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Seconds unless it is already a millisecond count.
  return new Date(n < 1e11 ? n * 1000 : n);
}

/**
 * The callback body: JSON, URL-encoded JSON (WayForPay sometimes posts the
 * whole JSON as the single key of a form body), or a plain form.
 */
export function parseWfpCallbackBody(text: string): unknown {
  const attempts = [
    () => text,
    () => decodeURIComponent(text).replace(/=$/, ''),
  ];
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt()) as unknown;
    } catch {
      // Next shape.
    }
  }
  const form = new URLSearchParams(text);
  return form.has('orderReference') ? Object.fromEntries(form.entries()) : null;
}

/**
 * A WayForPay transaction in the shape the entry-fee / donation state machine
 * already understands (`nextPaymentState`). A decline is NOT a failure here:
 * the page stays payable and the payer may try another card on it, and
 * CHECK_STATUS of an order nobody has paid yet also answers "Declined" (1127).
 */
export function wfpInvoiceStatus(tx: TWfpTransaction): TInvoiceStatus {
  switch (tx.transactionStatus) {
    case 'Approved':
      return 'success';
    case 'Refunded':
    case 'Voided':
      return 'reversed';
    case 'Expired':
      return 'expired';
    case 'InProcessing':
    case 'WaitingAuthComplete':
    case 'Pending':
    case 'Declined':
      return 'processing';
    default:
      return 'created';
  }
}
