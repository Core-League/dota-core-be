import { BadRequestException } from '@nestjs/common';
import { Tournament } from './tournaments.entity';

/**
 * The six dates that make up a tournament schedule, as three windows:
 * registration, qualification and playoff.
 */
export type TTournamentSchedule = Pick<
  Tournament,
  | 'registrationStartsAt'
  | 'registrationEndsAt'
  | 'qualificationStartsAt'
  | 'qualificationEndsAt'
  | 'tournamentStartsAt'
  | 'tournamentEndsAt'
>;

/** Every schedule column, for callers that need to know which keys to merge or coerce. */
export const TOURNAMENT_SCHEDULE_KEYS: Array<keyof TTournamentSchedule> = [
  'registrationStartsAt',
  'registrationEndsAt',
  'qualificationStartsAt',
  'qualificationEndsAt',
  'tournamentStartsAt',
  'tournamentEndsAt',
];

/** Schedule columns that define the qualification match-submission window. */
export const QUALIFICATION_WINDOW_KEYS: Array<keyof TTournamentSchedule> = [
  'qualificationStartsAt',
  'qualificationEndsAt',
];

type TScheduleRule = {
  before: keyof TTournamentSchedule;
  after: keyof TTournamentSchedule;
  /** true when `before === after` is acceptable (touching windows). */
  allowEqual: boolean;
  message: string;
};

/**
 * Ordering rules, in the order they are reported.
 *
 * Registration is deliberately allowed to overlap qualification: teams register
 * and play their qualifier the same evening, which is how every tournament
 * created before the windows were split behaves. The only cross-window rule is
 * that qualification must be over before the playoff bracket starts — the
 * auto-start scheduler would otherwise seed a bracket while results are still
 * being submitted.
 */
const SCHEDULE_RULES: TScheduleRule[] = [
  {
    before: 'registrationStartsAt',
    after: 'registrationEndsAt',
    allowEqual: false,
    message: 'Кінець реєстрації має бути пізніше за початок реєстрації',
  },
  {
    before: 'qualificationStartsAt',
    after: 'qualificationEndsAt',
    allowEqual: false,
    message: 'Кінець кваліфікації має бути пізніше за початок кваліфікації',
  },
  {
    before: 'tournamentStartsAt',
    after: 'tournamentEndsAt',
    allowEqual: false,
    message: 'Кінець плей-оф має бути пізніше за початок плей-оф',
  },
  {
    before: 'qualificationEndsAt',
    after: 'tournamentStartsAt',
    allowEqual: true,
    message: 'Кваліфікація має завершитися до початку плей-оф',
  },
];

/** First broken ordering rule, or null when the schedule is coherent. */
export function getScheduleViolation(
  schedule: TTournamentSchedule,
): string | null {
  for (const rule of SCHEDULE_RULES) {
    const before = schedule[rule.before]?.getTime();
    const after = schedule[rule.after]?.getTime();

    // A missing date is a DTO-validation problem, not an ordering one.
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;

    const ok = rule.allowEqual ? before <= after : before < after;
    if (!ok) return rule.message;
  }
  return null;
}

/** Throws a 400 with a Ukrainian message when the six dates are not coherent. */
export function validateTournamentSchedule(
  schedule: TTournamentSchedule,
): void {
  const violation = getScheduleViolation(schedule);
  if (violation) throw new BadRequestException(violation);
}
