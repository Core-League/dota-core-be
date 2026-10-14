/**
 * Payment status for a team's tournament entry fee.
 * - PENDING: a payment intent exists (reference generated) but no matching transaction yet.
 * - UNDERPAID: legacy state from the retired Monobank jar rail, where a matched transaction
 *   fell short of the entry fee. Never set by the current acquiring-invoice flow; retained
 *   only so historical rows keep rendering correctly.
 * - PAID: entry fee satisfied; the team is allowed to join the tournament.
 * - REFUNDED: the payment provider reported the paid invoice refunded or voided
 *   (WayForPay Refunded / Voided, Monobank reversed). Terminal for that
 *   invoice; the team is withdrawn if the tournament has not started. Paying
 *   again starts the row over. Donations share the enum.
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  UNDERPAID = 'UNDERPAID',
  PAID = 'PAID',
  REFUNDED = 'REFUNDED',
}
