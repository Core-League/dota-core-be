import {
  bracketOrdinalFromChallongeMatchAttrs,
  expectedDoubleEliminationMatchTotal,
  deFinalsBracketIndices,
  resolveDoubleElimBo3ByBracketOrdinal,
  PLAYOFF_BO3_FINALS_COUNT,
} from './playoff-finals-bo3';

describe('deFinalsBracketIndices', () => {
  it('examples N=4,8,16', () => {
    expect(deFinalsBracketIndices(4)).toEqual({
      upperBracketFinalIndex: 2,
      lowerBracketFinalIndex: 4,
      grandFinalIndex: 5,
    });
    expect(deFinalsBracketIndices(8)).toEqual({
      upperBracketFinalIndex: 6,
      lowerBracketFinalIndex: 12,
      grandFinalIndex: 13,
    });
    expect(deFinalsBracketIndices(16)).toEqual({
      upperBracketFinalIndex: 14,
      lowerBracketFinalIndex: 28,
      grandFinalIndex: 29,
    });
  });

  it('total matches formula 2N-2', () => {
    expect(expectedDoubleEliminationMatchTotal(8)).toBe(14);
  });
});

describe('resolveDoubleElimBo3ByBracketOrdinal', () => {
  it('maps ordinals exactly to Challonge IDs for clean 8-team bracket', () => {
    const rows = Array.from({ length: 14 }, (_, ord) => ({
      challongeNumericId: 5000 + ord,
      bracketOrdinal1Based: ord + 1,
    }));
    const out = resolveDoubleElimBo3ByBracketOrdinal(rows, 8);
    expect(out.bo3ChallongeIds.size).toBe(PLAYOFF_BO3_FINALS_COUNT);
    expect(out.finalTypeByChallongeId.get(5005)).toBe('upper_bracket_final');
    expect(out.finalTypeByChallongeId.get(5011)).toBe('lower_bracket_final');
    expect(out.finalTypeByChallongeId.get(5012)).toBe('grand_final');
  });

  it('flags missing ordinal data', () => {
    const out = resolveDoubleElimBo3ByBracketOrdinal(
      [{ challongeNumericId: 77, bracketOrdinal1Based: null }],
      8,
    );
    expect(out.bo3ChallongeIds.size).toBe(0);
    expect(out.diagnostics.some((d) => d.includes('WARN'))).toBe(true);
  });
});

describe('bracketOrdinalFromChallongeMatchAttrs', () => {
  it('prefers suggested_play_order', () => {
    expect(
      bracketOrdinalFromChallongeMatchAttrs({ suggested_play_order: 7 }),
    ).toBe(7);
  });
  it('parses numeric identifier prefixes', () => {
    expect(bracketOrdinalFromChallongeMatchAttrs({ identifier: 'M29' })).toBe(
      29,
    );
    expect(bracketOrdinalFromChallongeMatchAttrs({ identifier: '6' })).toBe(6);
  });
});
