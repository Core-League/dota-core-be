import { resolveFinalBo3ChallongeMatchIds } from './playoff-finals-bo3';

describe('resolveFinalBo3ChallongeMatchIds', () => {
  it('detects UB final (-2 pos), LB feeder (-1 neg), GF (max pos) for synthetic schedule', () => {
    const matches = [
      { id: 10, round: 1 }, // UB semis-ish
      { id: 11, round: 1 },
      { id: 20, round: 2 }, // UB final (single UB match before GF)
      { id: 30, round: 3 }, // GF
      { id: 40, round: -2 },
      { id: 41, round: -2 },
      { id: 50, round: -1 }, // LB final (closest to zero)
    ];
    const ids = resolveFinalBo3ChallongeMatchIds(matches);
    expect(ids.has(30)).toBe(true);
    expect(ids.has(20)).toBe(true);
    expect(ids.has(50)).toBe(true);
  });
});
