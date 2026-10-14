import { PaymentStatus } from './tournament-team-payment.model';

/** Invoice lifecycle states Monobank reports. */
export type TInvoiceStatus =
  | 'created'
  | 'processing'
  | 'hold'
  | 'success'
  | 'failure'
  | 'reversed'
  | 'expired';

/** The fields of an acquiring callback this decision needs. */
export type TInvoiceCallback = {
  invoiceId: string;
  status: TInvoiceStatus;
  amount?: number;
  finalAmount?: number;
  reference?: string;
  modifiedDate?: string;
};

/** The mutable part of a `tournament_team_payment` row. */
export type TPaymentSnapshot = {
  status: PaymentStatus;
  amountPaid: number;
  paidAt: Date | null;
  invoiceId: string | null;
  paymentPageUrl: string | null;
};

export type TPaymentStateChange = TPaymentSnapshot;

/** Statuses that end the invoice without money arriving. */
const DEAD_STATUSES: ReadonlySet<string> = new Set([
  'failure',
  'reversed',
  'expired',
]);

/**
 * The next state of a payment row given one callback, or null when nothing
 * changes.
 *
 * Monobank retries a callback up to three times and does not guarantee
 * ordering, so this must be idempotent and order-independent. Once money has
 * landed, the only move left is a refund: `reversed` (WayForPay Refunded /
 * Voided, Monobank reversed) naming the very invoice that paid turns PAID into
 * REFUNDED. Any other later push — a duplicate success, a stale failure, a
 * refund of some other invoice — leaves a PAID row alone, and REFUNDED is
 * terminal, so a repeated refund callback never revokes twice. Before payment,
 * `reversed` only releases the invoice like any dead status.
 */
export function nextPaymentState(
  current: TPaymentSnapshot,
  callback: TInvoiceCallback,
  now: Date,
): TPaymentStateChange | null {
  if (current.status === PaymentStatus.REFUNDED) return null;
  if (current.status === PaymentStatus.PAID) {
    if (
      callback.status !== 'reversed' ||
      callback.invoiceId !== current.invoiceId
    ) {
      return null;
    }
    return {
      status: PaymentStatus.REFUNDED,
      amountPaid: current.amountPaid,
      paidAt: current.paidAt,
      invoiceId: current.invoiceId,
      paymentPageUrl: null,
    };
  }

  if (callback.status === 'success') {
    const paid = callback.finalAmount ?? callback.amount ?? current.amountPaid;
    const modified = callback.modifiedDate
      ? new Date(callback.modifiedDate)
      : null;
    return {
      status: PaymentStatus.PAID,
      amountPaid: paid,
      paidAt: modified && !Number.isNaN(modified.getTime()) ? modified : now,
      invoiceId: callback.invoiceId,
      paymentPageUrl: null,
    };
  }

  if (DEAD_STATUSES.has(callback.status)) {
    // Only clear the invoice this callback is actually about. A dead push for
    // an id that no longer matches the row (a failure's own retry, or an
    // `expired` following a `failure`, arriving after the captain has already
    // re-requested and been handed a fresh invoice B) must not wipe B out from
    // under them via the reference fallback — that reopens the exact
    // double-charge window the payment-row lock in `createIntentForCaptain`
    // exists to close, just through a different callback. A dead callback
    // whose id no longer matches is a no-op.
    if (callback.invoiceId !== current.invoiceId) return null;

    // The captain simply pays again; the next intent mints a fresh invoice.
    return {
      status: current.status,
      amountPaid: current.amountPaid,
      paidAt: current.paidAt,
      invoiceId: null,
      paymentPageUrl: null,
    };
  }

  return null;
}
