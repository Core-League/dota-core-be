/**
 * BO3-слоти playoff (double elimination, один матч GF) за розміром сітки:
 * очікувана кількість матчів Challonge для N команд — 2*N−2,
 * серед них останні 3 матчі (за зростанням Challonge numeric id) — BO3; інші — BO1.
 *
 * У League API це узгоджується з `default_node_type=2` для BO3 (див. Dota2Service.createTwoTeamFixtureNode).
 */

/** Скільки останніх матчів у повній DE-сітці грають до двох перемог */
export const PLAYOFF_TAIL_BO3_COUNT = 3;

export function expectedDoubleEliminationMatchCount(teamCount: number): number {
  const n = Math.trunc(teamCount);
  if (!Number.isFinite(n) || n < 2) return 0;
  return 2 * n - 2;
}

/**
 * Challonge id впорядковані за зростанням числа → останні `tailCount` — UB final / LB final / GF для стандартної DE,
 * коли створення матчів у Challonge дає монотонні id із «ходом часу» сітки.
 */
export function bo3TailSortedMatchIds(
  matchNumericIds: readonly number[],
  tailCount = PLAYOFF_TAIL_BO3_COUNT,
): Set<number> {
  const uniqAsc = [...new Set(matchNumericIds)].sort((a, b) => a - b);
  if (uniqAsc.length <= tailCount) return new Set(uniqAsc);
  return new Set(uniqAsc.slice(-tailCount));
}

export interface PlayoffBo3Resolution {
  bo3Ids: Set<number>;
  expectedMatchCount: number;
  fetchedMatchCount: number;
}

export function computePlayoffBo3ChallongeMatchIds(
  allMatchNumericIds: readonly number[],
  activeTeamCount: number,
): PlayoffBo3Resolution {
  const expectedMatchCount =
    expectedDoubleEliminationMatchCount(activeTeamCount);
  const uniqAsc = [...new Set(allMatchNumericIds)].sort((a, b) => a - b);
  return {
    bo3Ids: bo3TailSortedMatchIds(uniqAsc),
    expectedMatchCount,
    fetchedMatchCount: uniqAsc.length,
  };
}
