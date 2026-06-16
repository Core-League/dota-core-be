/**
 * Lifecycle of a player's MMR-update request. `pending` once submitted (with
 * proof screenshots), then `approved` (the new MMR is written to the player) or
 * `rejected` by an admin.
 */
export enum MmrUpdateRequestStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}
