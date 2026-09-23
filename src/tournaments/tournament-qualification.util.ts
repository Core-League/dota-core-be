import { BadRequestException } from '@nestjs/common';
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
 * PLAYOFF, so it never has a meaningful QUALIFICATIONS status —
 * `TournamentQualificationScheduler` skips it.
 *
 * `tournamentSlots` is deliberately unconstrained: it is an optional
 * registration cap chosen by the admin, and a missing value means unlimited
 * registration. Without qualification there are no standings to cut by, so the
 * playoff simply seats every registered team (see
 * `PlayoffService.deriveTopEligibleTeamIds`).
 */
export function getQualificationConfigViolation(
  config: TQualificationConfig,
): string | null {
  if (config.hasQualification) return null;

  if (config.tournamentStatus === TournamentStatus.QUALIFICATIONS) {
    return 'Турнір без кваліфікації не може мати статус «Кваліфікація»';
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
