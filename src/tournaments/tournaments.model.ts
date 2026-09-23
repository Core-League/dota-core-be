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

/**
 * Playoff bracket format. Drives the Challonge bracket type, where the BO3
 * series sit (three finals in double elimination, the final alone in single
 * elimination) and the Dota 2 league fixture series length.
 *
 * Stored on the tournament only — the playoff engine reads it from the
 * tournament row every time it needs it. Editable until a playoff row exists.
 */
export enum TournamentBracketType {
  SINGLE_ELIMINATION = 'SINGLE_ELIMINATION',
  DOUBLE_ELIMINATION = 'DOUBLE_ELIMINATION',
}

export const DEFAULT_TOURNAMENT_BRACKET_TYPE =
  TournamentBracketType.DOUBLE_ELIMINATION;

/**
 * Series length of a playoff finals slot: a single map (BO1), a best-of-three
 * (BO3) or a best-of-five (BO5). Regular bracket rounds are always BO1; only
 * the finals slots — upper-bracket final, lower-bracket final and grand
 * final — are configurable, one value each, on the tournament row.
 */
export type SeriesBestOf = 1 | 3 | 5;

export const SERIES_BEST_OF_OPTIONS: readonly SeriesBestOf[] = [1, 3, 5];

/** Maps a series length to its wins-to-clinch: ⌈bestOf / 2⌉ (1, 2, 3). */
export function winsNeededForBestOf(bestOf: number): number {
  return Math.ceil(bestOf / 2);
}

/** Every finals slot was BO3 before the setting existed; the default keeps that. */
export const DEFAULT_FINAL_BEST_OF: SeriesBestOf = 3;
