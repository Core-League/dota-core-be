export type RankStarTier = {
  rankNumber: number;
  nameUk: string;
  /** 1..5 */
  star: 1 | 2 | 3 | 4 | 5;
  minRating: number;
};

export type ResolvedPlayerRank = {
  /** 1..8 */
  rankNumber: number;
  nameUk: string;
  /** 1..5 */
  stars: 1 | 2 | 3 | 4 | 5;
  /**
   * `rankNumber * 10 + stars` (наприклад, Легенда, 3 зорі → 53).
   * Для рангу 8 (Титан) завжди 81.
   */
  numericName: number;
  minRatingForTier: number;
};
