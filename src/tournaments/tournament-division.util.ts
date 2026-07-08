import { TournamentDivision } from './tournaments.model';

/**
 * Division is decided **only** by the roster's average rating — there is no
 * per-player ceiling. Two live divisions:
 *   - avg ≤ 6500        → DIVISION_I
 *   - avg > 6500        → DIVISION_II  (no upper limit)
 * Returns null for an empty roster. DIVISION_III is retained in the enum for
 * backward-compat but is never produced.
 */
export function computeTeamDivision(
  players: { rating: number }[],
): TournamentDivision | null {
  if (!players.length) return null;
  const avgRating =
    players.reduce((sum, p) => sum + p.rating, 0) / players.length;
  return avgRating <= 6500
    ? TournamentDivision.DIVISION_I
    : TournamentDivision.DIVISION_II;
}
