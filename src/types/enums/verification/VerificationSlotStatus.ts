/**
 * Lifecycle of a verification calendar slot. Admin publishes `free` 30-min
 * slots; a captain's booking flips one to `booked`; deleting a booked slot (or
 * cancelling its request) flips it to `cancelled`.
 */
export enum VerificationSlotStatus {
  Free = 'free',
  Booked = 'booked',
  Cancelled = 'cancelled',
}
