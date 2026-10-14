import type { TInvoiceCallbackPayload } from '../monobank-acquiring/monobank-acquiring.types';
import {
  parseWfpOrderReference,
  wfpAmountToKopecks,
  wfpInvoiceStatus,
  wfpTime,
  type TWfpTransaction,
} from './wayforpay.types';

/**
 * A WayForPay transaction as an acquiring callback, so entry fees and
 * donations settle through the same idempotent `nextPaymentState` as Monobank
 * ones: `invoiceId` is the order reference (what the row stores), `reference`
 * the row's own reference inside it (the fallback key), amounts in kopecks.
 */
export function wfpToInvoiceCallback(
  tx: TWfpTransaction,
  reference?: string,
): TInvoiceCallbackPayload {
  const amount = wfpAmountToKopecks(tx.amount);
  const modified = wfpTime(tx.processingDate) ?? wfpTime(tx.createdDate);
  const ownReference =
    reference ?? parseWfpOrderReference(tx.orderReference)?.reference;
  return {
    invoiceId: tx.orderReference,
    status: wfpInvoiceStatus(tx),
    ...(amount !== null ? { amount, finalAmount: amount } : {}),
    ...(ownReference ? { reference: ownReference } : {}),
    ...(modified ? { modifiedDate: modified.toISOString() } : {}),
    ...(tx.reason !== null && tx.reason !== undefined
      ? { failureReason: String(tx.reason) }
      : {}),
  };
}
