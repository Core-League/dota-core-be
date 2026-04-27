import type { RankStarTier } from './types';

export const UK_NAMES: Record<number, string> = {
  1: 'Герольд',
  2: 'Вартовий',
  3: 'Лицар',
  4: 'Архонт',
  5: 'Легенда',
  6: 'Древній',
  7: 'Божество',
  8: 'Титан',
};

/**
 * MMR "нижня межа" кожного підрівня (1–5 зірок) за рангами, як у вихідних таблиць.
 * Діапазон: гравець має досягти min наступного шару, щоб туди перейти.
 */
export const RANK_TO_STAR_MINS: Readonly<
  Record<number, readonly [number, number, number, number, number]>
> = {
  1: [0, 150, 300, 450, 610],
  2: [770, 920, 1080, 1230, 1400],
  3: [1540, 1700, 1850, 2000, 2150],
  4: [2310, 2450, 2610, 2770, 2930],
  5: [3080, 3230, 3390, 3540, 3700],
  6: [3850, 4000, 4150, 4300, 4460],
  7: [4620, 4820, 5020, 5220, 5420],
  /* Титан: 5620+; проміжні пороги до топу лідерборда — крок для 5 "зірок" UI */
  8: [5620, 6000, 7000, 8000, 9500],
};

/** Будує відсортований за `minRating` (asc) плоский список сходинок. */
export function buildSortedStarTiers(): readonly RankStarTier[] {
  const out: RankStarTier[] = [];
  for (const [rankStr, row] of Object.entries(RANK_TO_STAR_MINS)) {
    const rankNumber = Number(rankStr);
    const nameUk = UK_NAMES[rankNumber] ?? `Ранг ${rankNumber}`;
    const stars: readonly [1, 2, 3, 4, 5] = [1, 2, 3, 4, 5];
    for (let i = 0; i < 5; i++) {
      const minRating = row[i];
      if (minRating === undefined) continue;
      const star = stars[i];
      if (star === undefined) continue;
      out.push({
        rankNumber,
        nameUk,
        star,
        minRating,
      });
    }
  }
  return out.sort((a, b) => a.minRating - b.minRating);
}
