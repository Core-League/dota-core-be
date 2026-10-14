import { randomInt } from 'node:crypto';
import { MAIN_ROSTER_SIZE } from '../recruitment/recruitment.constants';

/** Unambiguous alphabet (no 0/O/1/I) for human-readable payment references. */
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERENCE_LENGTH = 6;
/** Entry-fee references; donations pass their own `DON-` prefix. */
const REFERENCE_PREFIX = 'CORE-';

/**
 * Generates a short, human-readable payment reference such as `CORE-7F3K9Q`.
 * Uniqueness is enforced by the DB unique constraint; callers should retry on conflict.
 */
export function generatePaymentReference(
  prefix: string = REFERENCE_PREFIX,
): string {
  let code = '';
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return `${prefix}${code}`;
}

/**
 * The entry fee (kopecks) split over a full main roster: what the site shows
 * as "per player". Informational only: the captain pays the whole fee.
 */
export function entryFeePerPlayer(entryFee: number): number {
  if (entryFee <= 0) return 0;
  return Math.round(entryFee / MAIN_ROSTER_SIZE);
}
