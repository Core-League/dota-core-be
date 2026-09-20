/** Monobank's own default and our cap: an invoice lives at most a day. */
export const INVOICE_MAX_VALIDITY_SEC = 24 * 60 * 60;

/**
 * Floor for the window. It only bites in the last quarter hour of registration,
 * where `getRegistrationBlockReason` is about to refuse the intent anyway; a
 * zero- or negative-length invoice would be rejected by Monobank outright.
 */
export const INVOICE_MIN_VALIDITY_SEC = 15 * 60;

/**
 * How long an invoice should stay payable: never longer than the registration
 * window it is paying into, never longer than a day.
 * If either date is invalid (e.g., parsing failure), returns the floor
 * instead of NaN, preserving the stated invariant.
 */
export function invoiceValiditySeconds(
  now: Date,
  registrationEndsAt: Date,
): number {
  const remaining = Math.floor(
    (registrationEndsAt.getTime() - now.getTime()) / 1000,
  );
  // Guard against Invalid Date or other non-finite results
  if (!Number.isFinite(remaining)) {
    return INVOICE_MIN_VALIDITY_SEC;
  }
  return Math.max(
    INVOICE_MIN_VALIDITY_SEC,
    Math.min(INVOICE_MAX_VALIDITY_SEC, remaining),
  );
}
