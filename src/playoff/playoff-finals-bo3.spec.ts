import {
  resolveStructuralFinalBo3Slots,
  type ChallongeBracketMatchNode,
} from './playoff-finals-bo3';

describe('resolveStructuralFinalBo3Slots', () => {
  it('double elim: UB final (+), LB final (-), GF (never referenced upstream)', () => {
    const nodes: ChallongeBracketMatchNode[] = [
      { id: 10, round: 1, prerequisiteMatchIds: [] },
      { id: 11, round: 1, prerequisiteMatchIds: [] },
      { id: 50, round: -12, prerequisiteMatchIds: [] },
      { id: 20, round: 4, prerequisiteMatchIds: [10, 11] },
      { id: 90, round: -2, prerequisiteMatchIds: [50] },
      { id: 300, round: 42, prerequisiteMatchIds: [20, 90] },
    ];

    const { bo3MatchIds, slotByMatchId } =
      resolveStructuralFinalBo3Slots(nodes);
    expect([...bo3MatchIds].sort((a, b) => a - b)).toEqual([20, 90, 300]);
    expect(slotByMatchId.get(300)).toBe('grand_final');
    expect(slotByMatchId.get(20)).toBe('upper_bracket_final');
    expect(slotByMatchId.get(90)).toBe('lower_bracket_final');
  });

  it('single elim (all nonnegative rounds): only grand final BO3', () => {
    const semiW = { id: 10, round: 2, prerequisiteMatchIds: [] as number[] };
    const semiX = { id: 11, round: 2, prerequisiteMatchIds: [] as number[] };

    const grandFinal = {
      id: 30,
      round: 7,
      prerequisiteMatchIds: [10, 11],
    };

    const { bo3MatchIds, slotByMatchId } = resolveStructuralFinalBo3Slots([
      semiW,
      semiX,
      grandFinal,
    ]);
    expect([...bo3MatchIds]).toEqual([30]);
    expect(slotByMatchId.get(30)).toBe('grand_final');
    expect(slotByMatchId.has(10)).toBe(false);
  });

  it('defaults to BO1 everywhere when prerequisites are missing', () => {
    const nodes: ChallongeBracketMatchNode[] = [
      { id: 100, round: 1, prerequisiteMatchIds: [] },
      { id: 101, round: 8, prerequisiteMatchIds: [] },
    ];
    expect(resolveStructuralFinalBo3Slots(nodes).bo3MatchIds.size).toBe(0);
  });
});
