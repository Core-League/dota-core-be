import {
  bracketOrdinalFromChallongeMatchAttrs,
  expectedDoubleEliminationMatchTotal,
  expectedSingleEliminationMatchTotal,
  resolveDoubleElimFinalsFromRounds,
  resolveSingleElimFinalsFromRounds,
  PLAYOFF_DE_FINALS_COUNT,
  PLAYOFF_SE_FINALS_COUNT,
  type BracketRoundedRow,
} from './playoff-finals-bo3';
import { type FinalsBestOf } from '../tournaments/tournament-bracket.util';

const ALL_BO3: FinalsBestOf = {
  upper_bracket_final: 3,
  lower_bracket_final: 3,
  grand_final: 3,
};

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
    const out = resolveDoubleElimFinalsFromRounds(rows, 4, ALL_BO3);

    expect(out.finalsChallongeIds.size).toBe(PLAYOFF_DE_FINALS_COUNT);
    expect(out.finalTypeByChallongeId.get(103)).toBe('upper_bracket_final');
    expect(out.finalTypeByChallongeId.get(105)).toBe('lower_bracket_final');
    expect(out.finalTypeByChallongeId.get(106)).toBe('grand_final');
    expect([...out.bestOfByChallongeId.values()]).toEqual([3, 3, 3]);
    expect(out.diagnostics.some((d) => d.startsWith('ERROR'))).toBe(false);
  });

  it('applies the configured series length per finals slot', () => {
    const rows: BracketRoundedRow[] = [
      { challongeNumericId: 101, round: 1 },
      { challongeNumericId: 102, round: 1 },
      { challongeNumericId: 103, round: 2 }, // UBF
      { challongeNumericId: 104, round: -1 },
      { challongeNumericId: 105, round: -2 }, // LBF
      { challongeNumericId: 106, round: 3 }, // GF
    ];
    const out = resolveDoubleElimFinalsFromRounds(rows, 4, {
      upper_bracket_final: 1,
      lower_bracket_final: 3,
      grand_final: 5,
    });

    expect(out.finalsChallongeIds.size).toBe(PLAYOFF_DE_FINALS_COUNT);
    expect(out.bestOfByChallongeId.get(103)).toBe(1);
    expect(out.bestOfByChallongeId.get(105)).toBe(3);
    expect(out.bestOfByChallongeId.get(106)).toBe(5);
    // Regular rounds are never finals and carry no series length.
    expect(out.finalsChallongeIds.has(101)).toBe(false);
    expect(out.bestOfByChallongeId.has(101)).toBe(false);
  });

  it('correctly identifies UBF / LBF / GF for N=8', () => {
    // N=8: total=14 matches
    // UB: R1(4 matches, round=1), R2(2, round=2), UBF(1, round=3)
    // LB: R1(2, round=-1), R2(2, round=-2), R3(1, round=-3), LBF(1, round=-4)
    // GF: round=4
    const rows: BracketRoundedRow[] = [
      // UB R1
      { challongeNumericId: 201, round: 1 },
      { challongeNumericId: 202, round: 1 },
      { challongeNumericId: 203, round: 1 },
      { challongeNumericId: 204, round: 1 },
      // UB R2
      { challongeNumericId: 205, round: 2 },
      { challongeNumericId: 206, round: 2 },
      // UBF
      { challongeNumericId: 207, round: 3 },
      // LB
      { challongeNumericId: 208, round: -1 },
      { challongeNumericId: 209, round: -1 },
      { challongeNumericId: 210, round: -2 },
      { challongeNumericId: 211, round: -2 },
      { challongeNumericId: 212, round: -3 },
      // LBF
      { challongeNumericId: 213, round: -4 },
      // GF
      { challongeNumericId: 214, round: 4 },
    ];
    const out = resolveDoubleElimFinalsFromRounds(rows, 8, ALL_BO3);

    expect(out.finalsChallongeIds.size).toBe(PLAYOFF_DE_FINALS_COUNT);
    expect(out.finalTypeByChallongeId.get(207)).toBe('upper_bracket_final');
    expect(out.finalTypeByChallongeId.get(213)).toBe('lower_bracket_final');
    expect(out.finalTypeByChallongeId.get(214)).toBe('grand_final');
    expect(out.diagnostics.some((d) => d.startsWith('ERROR'))).toBe(false);
  });

  it('correctly identifies UBF / LBF / GF for N=16', () => {
    // N=16: total=30 matches
    // UB rounds 1..4 (UBF=round 4), LB rounds -1..-6 (LBF=round -6), GF round 5
    const rows: BracketRoundedRow[] = [];
    let id = 300;
    // UB
    for (let r = 1; r <= 4; r++) {
      const count = 16 / Math.pow(2, r);
      for (let i = 0; i < count; i++) {
        rows.push({ challongeNumericId: id++, round: r });
      }
    }
    // LB: rounds -1..-6 with sizes 4,4,2,2,1,1
    const lbSizes = [4, 4, 2, 2, 1, 1];
    for (let r = 0; r < lbSizes.length; r++) {
      for (let i = 0; i < lbSizes[r]; i++) {
        rows.push({ challongeNumericId: id++, round: -(r + 1) });
      }
    }
    // GF
    const gfId = id++;
    rows.push({ challongeNumericId: gfId, round: 5 });

    const out = resolveDoubleElimFinalsFromRounds(rows, 16, ALL_BO3);

    expect(out.finalsChallongeIds.size).toBe(PLAYOFF_DE_FINALS_COUNT);
    expect(out.finalTypeByChallongeId.get(gfId)).toBe('grand_final');

    const ubfIds = rows
      .filter((r) => r.round === 4)
      .map((r) => r.challongeNumericId);
    expect(ubfIds).toHaveLength(1);
    expect(out.finalTypeByChallongeId.get(ubfIds[0])).toBe(
      'upper_bracket_final',
    );

    const lbfIds = rows
      .filter((r) => r.round === -6)
      .map((r) => r.challongeNumericId);
    expect(lbfIds).toHaveLength(1);
    expect(out.finalTypeByChallongeId.get(lbfIds[0])).toBe(
      'lower_bracket_final',
    );
    expect(out.diagnostics.some((d) => d.startsWith('ERROR'))).toBe(false);
  });

  it('returns empty and logs error for teamCount < 3', () => {
    const rows: BracketRoundedRow[] = [{ challongeNumericId: 1, round: 1 }];
    const out = resolveDoubleElimFinalsFromRounds(rows, 2, ALL_BO3);
    expect(out.finalsChallongeIds.size).toBe(0);
    expect(out.bestOfByChallongeId.size).toBe(0);
    expect(out.diagnostics.some((d) => d.startsWith('Skip'))).toBe(true);
  });

  it('logs error when no negative-round matches exist', () => {
    const rows: BracketRoundedRow[] = [
      { challongeNumericId: 1, round: 1 },
      { challongeNumericId: 2, round: 2 },
    ];
    const out = resolveDoubleElimFinalsFromRounds(rows, 4, ALL_BO3);
    expect(out.finalsChallongeIds.size).toBe(0);
    expect(out.diagnostics.some((d) => d.includes('no negative-round'))).toBe(
      true,
    );
  });

  it('warns but does not error when row count mismatches expected total', () => {
    const rows: BracketRoundedRow[] = [
      { challongeNumericId: 1, round: 1 },
      { challongeNumericId: 2, round: 2 }, // UBF
      { challongeNumericId: 3, round: -1 }, // LBF
      { challongeNumericId: 4, round: 3 }, // GF
    ];
    const out = resolveDoubleElimFinalsFromRounds(rows, 4, ALL_BO3);
    expect(out.finalsChallongeIds.size).toBe(PLAYOFF_DE_FINALS_COUNT);
    expect(out.diagnostics.some((d) => d.includes('WARN: received'))).toBe(
      true,
    );
  });
});

describe('resolveSingleElimFinalsFromRounds', () => {
  const rowsN4: BracketRoundedRow[] = [
    { challongeNumericId: 11, round: 1 },
    { challongeNumericId: 12, round: 1 },
    { challongeNumericId: 13, round: 2 }, // final
  ];

  it('marks the top-round node as the final with the configured length', () => {
    const out = resolveSingleElimFinalsFromRounds(rowsN4, 4, {
      ...ALL_BO3,
      grand_final: 5,
    });
    expect(out.finalsChallongeIds.size).toBe(PLAYOFF_SE_FINALS_COUNT);
    expect(out.finalTypeByChallongeId.get(13)).toBe('grand_final');
    expect(out.bestOfByChallongeId.get(13)).toBe(5);
  });

  it('leaves the third-place node as a regular BO1 slot', () => {
    const rows = [...rowsN4, { challongeNumericId: 14, round: 2 }];
    const out = resolveSingleElimFinalsFromRounds(rows, 4, ALL_BO3, true);
    expect([...out.finalsChallongeIds]).toEqual([13]);
    expect(out.bestOfByChallongeId.has(14)).toBe(false);
  });
});

describe('expected match totals', () => {
  it('double elimination is 2N-2', () => {
    expect(expectedDoubleEliminationMatchTotal(4)).toBe(6);
    expect(expectedDoubleEliminationMatchTotal(8)).toBe(14);
    expect(expectedDoubleEliminationMatchTotal(16)).toBe(30);
    expect(expectedDoubleEliminationMatchTotal(32)).toBe(62);
    expect(expectedDoubleEliminationMatchTotal(1)).toBe(0);
  });

  it('single elimination is N-1, plus the third-place node from N=4', () => {
    expect(expectedSingleEliminationMatchTotal(8)).toBe(7);
    expect(expectedSingleEliminationMatchTotal(8, true)).toBe(8);
    expect(expectedSingleEliminationMatchTotal(2, true)).toBe(1);
  });
});

describe('bracketOrdinalFromChallongeMatchAttrs (deprecated)', () => {
  it('prefers suggested_play_order', () => {
    expect(
      bracketOrdinalFromChallongeMatchAttrs({ suggested_play_order: 7 }),
    ).toBe(7);
  });
  it('parses numeric identifier prefixes', () => {
    expect(bracketOrdinalFromChallongeMatchAttrs({ identifier: 'M12' })).toBe(
      12,
    );
    expect(bracketOrdinalFromChallongeMatchAttrs({ identifier: 'zz' })).toBe(
      null,
    );
  });
});
