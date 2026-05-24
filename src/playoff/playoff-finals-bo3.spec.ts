import {
  bracketOrdinalFromChallongeMatchAttrs,
  expectedDoubleEliminationMatchTotal,
  deFinalsBracketIndices,
  resolveDoubleElimBo3ByBracketOrdinal,
  resolveDoubleElimFinalsFromRounds,
  PLAYOFF_BO3_FINALS_COUNT,
  type BracketRoundedRow,
} from './playoff-finals-bo3';

// ── Round-based resolver (primary) ────────────────────────────────────────────

describe('resolveDoubleElimFinalsFromRounds', () => {
  it('correctly identifies UBF / LBF / GF for N=4', () => {
    // N=4: UBR1(2), UBF(1), LBR1(1), LBF(1), GF(1) = 6 total = 2*4-2 ✓
    // rounds: UBR1=1, UBF=2, LBR1=-1, LBF=-2, GF=3
    const rows: BracketRoundedRow[] = [
      { challongeNumericId: 101, round: 1 },
      { challongeNumericId: 102, round: 1 },
      { challongeNumericId: 103, round: 2 }, // UBF
      { challongeNumericId: 104, round: -1 },
      { challongeNumericId: 105, round: -2 }, // LBF
      { challongeNumericId: 106, round: 3 }, // GF
    ];
    const out = resolveDoubleElimFinalsFromRounds(rows, 4);

    expect(out.bo3ChallongeIds.size).toBe(PLAYOFF_BO3_FINALS_COUNT);
    expect(out.finalTypeByChallongeId.get(103)).toBe('upper_bracket_final');
    expect(out.finalTypeByChallongeId.get(105)).toBe('lower_bracket_final');
    expect(out.finalTypeByChallongeId.get(106)).toBe('grand_final');
    expect(out.diagnostics.some((d) => d.startsWith('ERROR'))).toBe(false);
  });

  it('correctly identifies UBF / LBF / GF for N=8', () => {
    // N=8: total=14 matches
    // rounds: UBR1=1(4), UBR2=2(2), UBF=3(1), LBR1=-1(2), LBR2=-2(2), LBR3=-3(1), LBF=-4(1), GF=4(1)
    const rows: BracketRoundedRow[] = [
      // UBR1
      { challongeNumericId: 201, round: 1 },
      { challongeNumericId: 202, round: 1 },
      { challongeNumericId: 203, round: 1 },
      { challongeNumericId: 204, round: 1 },
      // UBR2
      { challongeNumericId: 205, round: 2 },
      { challongeNumericId: 206, round: 2 },
      // UBF
      { challongeNumericId: 207, round: 3 },
      // LBR1
      { challongeNumericId: 208, round: -1 },
      { challongeNumericId: 209, round: -1 },
      // LBR2
      { challongeNumericId: 210, round: -2 },
      { challongeNumericId: 211, round: -2 },
      // LBR3
      { challongeNumericId: 212, round: -3 },
      // LBF
      { challongeNumericId: 213, round: -4 },
      // GF
      { challongeNumericId: 214, round: 4 },
    ];
    const out = resolveDoubleElimFinalsFromRounds(rows, 8);

    expect(out.bo3ChallongeIds.size).toBe(PLAYOFF_BO3_FINALS_COUNT);
    expect(out.finalTypeByChallongeId.get(207)).toBe('upper_bracket_final');
    expect(out.finalTypeByChallongeId.get(213)).toBe('lower_bracket_final');
    expect(out.finalTypeByChallongeId.get(214)).toBe('grand_final');
    expect(out.diagnostics.some((d) => d.startsWith('ERROR'))).toBe(false);
  });

  it('correctly identifies UBF / LBF / GF for N=16', () => {
    // N=16: total=30 matches
    // UB rounds 1-4 (UBF=round 4), LB rounds -1..-6 (LBF=round -6), GF=round 5
    const rows: BracketRoundedRow[] = [];
    let id = 300;

    const push = (round: number): number => {
      rows.push({ challongeNumericId: id, round });
      return id++;
    };

    // UB rounds
    for (let i = 0; i < 8; i++) push(1); // UBR1: 8 matches
    for (let i = 0; i < 4; i++) push(2); // UBR2: 4 matches
    for (let i = 0; i < 2; i++) push(3); // UBR3: 2 matches
    const ubfId = push(4); // UBF:  1 match (round 4)

    // LB rounds
    for (let i = 0; i < 4; i++) push(-1); // LBR1: 4 matches
    for (let i = 0; i < 4; i++) push(-2); // LBR2: 4 matches
    for (let i = 0; i < 2; i++) push(-3); // LBR3: 2 matches
    for (let i = 0; i < 2; i++) push(-4); // LBR4: 2 matches
    push(-5); // LBR5: 1 match
    const lbfId = push(-6); // LBF:  1 match (round -6)

    // GF
    const gfId = push(5); // GF: round 5

    expect(rows.length).toBe(30); // 2*16-2 ✓

    const out = resolveDoubleElimFinalsFromRounds(rows, 16);

    expect(out.bo3ChallongeIds.size).toBe(PLAYOFF_BO3_FINALS_COUNT);
    expect(out.finalTypeByChallongeId.get(ubfId)).toBe('upper_bracket_final');
    expect(out.finalTypeByChallongeId.get(lbfId)).toBe('lower_bracket_final');
    expect(out.finalTypeByChallongeId.get(gfId)).toBe('grand_final');
    expect(out.diagnostics.some((d) => d.startsWith('ERROR'))).toBe(false);
  });

  it('returns empty and logs error for teamCount < 4', () => {
    const out = resolveDoubleElimFinalsFromRounds([], 2);
    expect(out.bo3ChallongeIds.size).toBe(0);
    expect(out.diagnostics.some((d) => d.includes('invalid teamCount'))).toBe(
      true,
    );
  });

  it('logs error when no negative-round matches exist', () => {
    const rows: BracketRoundedRow[] = [
      { challongeNumericId: 1, round: 1 },
      { challongeNumericId: 2, round: 2 },
    ];
    const out = resolveDoubleElimFinalsFromRounds(rows, 4);
    expect(out.bo3ChallongeIds.size).toBe(0);
    expect(out.diagnostics.some((d) => d.startsWith('ERROR'))).toBe(true);
  });

  it('warns but does not error when row count mismatches expected total', () => {
    // Valid finals rounds, one extra match at round 1
    const rows: BracketRoundedRow[] = [
      { challongeNumericId: 1, round: 1 },
      { challongeNumericId: 2, round: 1 },
      { challongeNumericId: 3, round: 1 }, // extra
      { challongeNumericId: 4, round: 2 }, // UBF
      { challongeNumericId: 5, round: -1 },
      { challongeNumericId: 6, round: -2 }, // LBF
      { challongeNumericId: 7, round: 3 }, // GF
    ];
    const out = resolveDoubleElimFinalsFromRounds(rows, 4);
    expect(out.bo3ChallongeIds.size).toBe(PLAYOFF_BO3_FINALS_COUNT);
    expect(out.diagnostics.some((d) => d.startsWith('WARN'))).toBe(true);
    expect(out.diagnostics.some((d) => d.startsWith('ERROR'))).toBe(false);
  });
});

// ── Total matches formula ─────────────────────────────────────────────────────

describe('expectedDoubleEliminationMatchTotal', () => {
  it('returns 2N-2 for standard sizes', () => {
    expect(expectedDoubleEliminationMatchTotal(4)).toBe(6);
    expect(expectedDoubleEliminationMatchTotal(8)).toBe(14);
    expect(expectedDoubleEliminationMatchTotal(16)).toBe(30);
  });
});

// ── @deprecated legacy ordinal-based helpers (kept for regression) ────────────

describe('deFinalsBracketIndices (deprecated)', () => {
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
});

describe('resolveDoubleElimBo3ByBracketOrdinal (deprecated)', () => {
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

describe('bracketOrdinalFromChallongeMatchAttrs (deprecated)', () => {
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
