/**
 * Payment status for a team's tournament entry fee.
 * - PENDING: a payment intent exists (reference generated) but no matching transaction yet.
 * - UNDERPAID: a matching transaction was found but its amount is below the entry fee.
 * - PAID: entry fee satisfied; the team is allowed to join the tournament.
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  UNDERPAID = 'UNDERPAID',
  PAID = 'PAID',
}
