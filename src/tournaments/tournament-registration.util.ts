import { Tournament } from './tournaments.entity';

export enum RegistrationBlockReason {
  /** `now` is before `registrationStartsAt`. */
  NOT_OPEN_YET = 'NOT_OPEN_YET',
  /** `now` is past `registrationEndsAt`. */
  DEADLINE_PASSED = 'DEADLINE_PASSED',
  /** An admin closed registration early (`registrationClosedAt` is set). */
  CLOSED_BY_ADMIN = 'CLOSED_BY_ADMIN',
}

/**
 * Ukrainian messages thrown to captains.
 *
 * DEADLINE_PASSED must stay byte-identical to the string the frontend already
 * pattern-matches in `joinFriendlyHintFromApi` (Tournament.vue), and
 * CLOSED_BY_ADMIN is a superstring of it so the same `.includes()` check
 * catches both without a frontend change.
 */
export const REGISTRATION_BLOCK_MESSAGES: Record<
  RegistrationBlockReason,
  string
> = {
  [RegistrationBlockReason.NOT_OPEN_YET]: 'Реєстрація на турнір ще не відкрита',
  [RegistrationBlockReason.DEADLINE_PASSED]: 'Реєстрація на турнір закрита',
  [RegistrationBlockReason.CLOSED_BY_ADMIN]:
    'Реєстрація на турнір закрита адміністратором',
};

type TRegistrationWindow = Pick<
  Tournament,
  'registrationStartsAt' | 'registrationEndsAt' | 'registrationClosedAt'
>;

/**
 * The single source of truth for "can a team register right now".
 * Returns null when registration is open, otherwise why it is blocked.
 *
 * A manual close wins over the dates so the admin action is reported as such
 * even when it happens to land outside the scheduled window.
 */
export function getRegistrationBlockReason(
  tournament: TRegistrationWindow,
  now: Date = new Date(),
): RegistrationBlockReason | null {
  if (tournament.registrationClosedAt) {
    return RegistrationBlockReason.CLOSED_BY_ADMIN;
  }
  if (now < tournament.registrationStartsAt) {
    return RegistrationBlockReason.NOT_OPEN_YET;
  }
  if (now > tournament.registrationEndsAt) {
    return RegistrationBlockReason.DEADLINE_PASSED;
  }
  return null;
}

export function isRegistrationOpen(
  tournament: TRegistrationWindow,
  now: Date = new Date(),
): boolean {
  return getRegistrationBlockReason(tournament, now) === null;
}

/** Ukrainian message for a blocked registration, for throwing straight into a 400. */
export function registrationBlockMessage(
  reason: RegistrationBlockReason,
): string {
  return REGISTRATION_BLOCK_MESSAGES[reason];
}
