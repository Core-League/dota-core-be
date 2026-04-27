import { buildSortedStarTiers } from './tier-thresholds.build';
import type { ResolvedPlayerRank, RankStarTier } from './types';

const TITAN_RANK = 8;

const sortedTiers: readonly RankStarTier[] = buildSortedStarTiers();

/**
 * `rank*10 + stars` для рангів 1–7, для Титану (8) — завжди 81.
 */
export function computeNumericRankName(
  rankNumber: number,
  stars: number,
): number {
  if (rankNumber === TITAN_RANK) {
    return 81;
  }
  return rankNumber * 10 + stars;
}

/**
 * За цілочисельним рейтингом повертає поточний «медальний» крок: остання сходинка,
 * для якої `rating >= minRating` (доти, доки не досягнута мін. межа наступного рівня).
 */
export function resolvePlayerRankFromNumericRating(
  rawRating: number,
): ResolvedPlayerRank {
  const rating = Math.max(0, Math.floor(rawRating));
  if (sortedTiers.length === 0) {
    return fallbackRank();
  }
  let current = sortedTiers[0];
  if (current == null) {
    return fallbackRank();
  }
  for (const t of sortedTiers) {
    if (rating >= t.minRating) {
      current = t;
    } else {
      break;
    }
  }
  return {
    rankNumber: current.rankNumber,
    nameUk: current.nameUk,
    stars: current.star,
    numericName: computeNumericRankName(current.rankNumber, current.star),
    minRatingForTier: current.minRating,
  };
}

function fallbackRank(): ResolvedPlayerRank {
  return {
    rankNumber: 1,
    nameUk: 'Рекрут',
    stars: 1,
    numericName: 11,
    minRatingForTier: 0,
  };
}

export { buildSortedStarTiers, sortedTiers };
