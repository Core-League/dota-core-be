import {
  PLAYOFF_TAIL_BO3_COUNT,
  bo3TailSortedMatchIds,
  computePlayoffBo3ChallongeMatchIds,
  expectedDoubleEliminationMatchCount,
} from './playoff-finals-bo3';

describe('expectedDoubleEliminationMatchCount', () => {
  it('follows 2*N-2 for N≥2', () => {
    expect(expectedDoubleEliminationMatchCount(0)).toBe(0);
    expect(expectedDoubleEliminationMatchCount(1)).toBe(0);
    expect(expectedDoubleEliminationMatchCount(4)).toBe(6);
    expect(expectedDoubleEliminationMatchCount(8)).toBe(14);
    expect(expectedDoubleEliminationMatchCount(16)).toBe(30);
  });
});

describe('bo3TailSortedMatchIds', () => {
  it('marks last PLAYOFF_TAIL_BO3_COUNT ids when sorted ascending', () => {
    const mids = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(PLAYOFF_TAIL_BO3_COUNT).toBe(3);
    expect([...bo3TailSortedMatchIds(mids)].sort((a, b) => a - b)).toEqual([
      80, 90, 100,
    ]);
  });

  it('when fewer matches than tail, all are tail BO3', () => {
    expect([...bo3TailSortedMatchIds([900, 30])].sort((a, b) => a - b)).toEqual(
      [30, 900],
    );
  });
});

describe('computePlayoffBo3ChallongeMatchIds', () => {
  it('delegates tail selection', () => {
    const mids = Array.from({ length: 14 }, (_, i) => i + 501);
    const res = computePlayoffBo3ChallongeMatchIds(mids, 8);
    expect(res.expectedMatchCount).toBe(14);
    expect(res.fetchedMatchCount).toBe(14);
    expect([...res.bo3Ids]).toEqual([512, 513, 514]);
  });
});
