import { BadRequestException } from '@nestjs/common';
import { PLAYOFF_TEAM_LIMIT } from '../playoff/playoff.constants';
import { TournamentStatus } from './tournaments.model';

/**
 * The tournament fields that must agree with each other about the qualification
 * stage. Kept structural rather than `Pick<Tournament, …>` so both the create
 * DTO (slots arrive as `number | undefined`) and the entity satisfy it.
 */
export type TQualificationConfig = {
  hasQualification: boolean;
  tournamentSlots?: number | null;
  tournamentStatus: TournamentStatus;
};

/**
 * First broken rule, or null when the configuration is coherent.
 *
 * A tournament without a qualification stage goes straight from REGISTRATION to
 * PLAYOFF, which costs it the two things qualification would have provided:
 *
 * 1. Standings to rank by. `PlayoffService.selectTopTeamsByStandings` falls back
 *    to sorting on team id once every captain has zero points, so a field larger
 *    than the bracket would be cut arbitrarily. Capping `tournamentSlots` at the
 *    bracket size means joining is already limited (see the slots check in
 *    `QualificationService.joinTournament`) and the cut can never happen.
 * 2. A meaningful QUALIFICATIONS status, which such a tournament never enters —
 *    `TournamentQualificationScheduler` skips it.
 */
export function getQualificationConfigViolation(
  config: TQualificationConfig,
): string | null {
  if (config.hasQualification) return null;

  if (config.tournamentStatus === TournamentStatus.QUALIFICATIONS) {
    return 'Турнір без кваліфікації не може мати статус «Кваліфікація»';
  }

  const slots = config.tournamentSlots;
  if (slots === null || slots === undefined) {
    return (
      'Для турніру без кваліфікації потрібно вказати слоти команд ' +
      `(не більше ${PLAYOFF_TEAM_LIMIT})`
    );
  }
  if (slots > PLAYOFF_TEAM_LIMIT) {
    return `Без кваліфікації слотів команд не може бути більше ${PLAYOFF_TEAM_LIMIT}`;
  }

  return null;
}

/** Throws a 400 with a Ukrainian message when the qualification config is incoherent. */
export function validateQualificationConfig(
  config: TQualificationConfig,
): void {
  const violation = getQualificationConfigViolation(config);
  if (violation) throw new BadRequestException(violation);
}
