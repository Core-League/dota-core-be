/**
 * Lifecycle of a captain's verification request. `pending` once booked, moves to
 * `processing` when an admin picks it up, then `completed` (MMR written) or
 * `cancelled`.
 */
export enum VerificationRequestStatus {
  Pending = 'pending',
  Processing = 'processing',
  Completed = 'completed',
  Cancelled = 'cancelled',
}
