/**
 * Identifies Challonge bracket match IDs that correspond to BO3 finals in a
 * double-elimination tree: Upper Bracket Final, Lower Bracket Final, Grand Final.
 *
 * Winners-side: among positive rounds, grand final matches share the highest round
 * number. The upper-bracket final is the first positive round strictly below GF that
 * has exactly one winners-bracket match.
 * Losers-side: LB final match is singled out by scanning distinct negative rounds
 * from closest to zero downward (`-1`, `-2`, …) until a round exists with exactly
 * one losers match — that identifier is LB final per standard Challonge numbering.
 */

export interface ChallongeMatchRoundRef {
  id: number;
  round: number;
}

export function resolveFinalBo3ChallongeMatchIds(
  matches: ChallongeMatchRoundRef[],
): Set<number> {
  const ids = new Set<number>();
  if (!matches.length) return ids;

  const positive = matches.filter((m) => m.round > 0);
  const negative = matches.filter((m) => m.round < 0);

  if (positive.length === 0) return ids;

  const maxPositive = Math.max(...positive.map((m) => m.round));
  for (const m of positive) {
    if (m.round === maxPositive) ids.add(m.id);
  }

  const ubRoundsDescending = [...new Set(positive.map((m) => m.round))]
    .sort((a, b) => b - a)
    .filter((r) => r < maxPositive);

  for (const r of ubRoundsDescending) {
    const bucket = positive.filter((m) => m.round === r);
    if (bucket.length === 1) {
      ids.add(bucket[0].id);
      break;
    }
  }

  if (negative.length > 0) {
    const negRoundsByClosestToZero = [
      ...new Set(negative.map((m) => m.round)),
    ].sort((a, b) => b - a);
    for (const r of negRoundsByClosestToZero) {
      const bucket = negative.filter((m) => m.round === r);
      if (bucket.length === 1) {
        ids.add(bucket[0].id);
        break;
      }
    }
  }

  return ids;
}
