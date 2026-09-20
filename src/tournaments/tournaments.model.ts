export enum TournamentStatus {
  REGISTRATION = 'REGISTRATION',
  QUALIFICATIONS = 'QUALIFICATIONS',
  PLAYOFF = 'PLAYOFF',
  COMPLETED = 'COMPLETED',
}

/**
 * Statuses in which a team may still join a tournament and pay its entry fee.
 *
 * Both phases count: the registration window is allowed to run on into
 * qualification, so a team can register and play its qualifier the same
 * evening. Whether registration is actually open is decided by the dates —
 * see `getRegistrationBlockReason`.
 */
export const JOINABLE_TOURNAMENT_STATUSES: readonly TournamentStatus[] = [
  TournamentStatus.REGISTRATION,
  TournamentStatus.QUALIFICATIONS,
];

export function isJoinableStatus(status: TournamentStatus): boolean {
  return JOINABLE_TOURNAMENT_STATUSES.includes(status);
}

export enum TournamentDivision {
  DIVISION_I = 'DIVISION_I',
  DIVISION_II = 'DIVISION_II',
  DIVISION_III = 'DIVISION_III',
}
