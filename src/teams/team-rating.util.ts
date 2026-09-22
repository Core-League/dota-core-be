/** The roster's mean rating, unrounded. Null for an empty roster. */
export function computeTeamAvgRating(
  players: { rating: number }[],
): number | null {
  if (!players.length) return null;
  return players.reduce((sum, p) => sum + p.rating, 0) / players.length;
}
