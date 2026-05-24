/**
 * BO3-finals detection for double-elimination brackets.
 *
 * Primary strategy (round-based, preferred):
 *   resolveDoubleElimFinalsFromRounds — uses Challonge round numbers to
 *   deterministically identify UBF, LBF and GF for any N.
 *
 *   Challonge assigns positive round numbers to upper-bracket matches and
 *   negative round numbers to lower-bracket matches:
 *     GF  = match with the highest positive round
 *     UBF = match with round = GF.round − 1  (last UB round before GF)
 *     LBF = match with the most negative round  (last LB round)
 *
 * @deprecated Legacy ordinal-based helpers below are kept for reference only.
 */

export type FinalsSlotKind =
  | 'upper_bracket_final'
  | 'lower_bracket_final'
  | 'grand_final';

export const PLAYOFF_BO3_FINALS_COUNT = 3;

export function isPowerOfTwoTeamCount(teamCount: number): boolean {
  const n = Math.trunc(teamCount);
  return n >= 2 && Number.isFinite(n) && (n & (n - 1)) === 0;
}

/** Total matches in a full DE bracket (single GF). */
export function expectedDoubleEliminationMatchTotal(teamCount: number): number {
  const N = Math.trunc(teamCount);
  if (!Number.isFinite(N) || N < 2) return 0;
  return 2 * N - 2;
}

// ── Shared output type ────────────────────────────────────────────────────────

export interface ResolvedDeBo3 {
  /** Challonge match IDs that should be bestOf=3 */
  bo3ChallongeIds: Set<number>;
  finalTypeByChallongeId: Map<number, FinalsSlotKind>;
  /** Stores the Challonge round number for each BO3 match (diagnostic use). */
  bracketOrdinalByChallongeId: Map<number, number>;
  diagnostics: string[];
}

// ── Round-based resolver (preferred) ─────────────────────────────────────────

export interface BracketRoundedRow {
  challongeNumericId: number;
  /** Challonge round: positive = upper bracket, negative = lower bracket, max positive = GF. */
  round: number;
}

/**
 * Identify UBF, LBF and GF from Challonge round numbers.
 * Works for any power-of-two N ≥ 4 without hard-coded index formulas.
 */
export function resolveDoubleElimFinalsFromRounds(
  rows: readonly BracketRoundedRow[],
  activeTeamCount: number,
): ResolvedDeBo3 {
  const diags: string[] = [];
  const N = Math.trunc(activeTeamCount);
  const expectedTotal = expectedDoubleEliminationMatchTotal(N);

  diags.push(
    `DE sizing: N(active)=${N} expectedTotalMatches=${expectedTotal} strategy=round-based`,
  );

  if (!Number.isFinite(N) || N < 4) {
    diags.push('Skip DE BO3: invalid teamCount (< 4)');
    return empty(diags);
  }

  if (!isPowerOfTwoTeamCount(N)) {
    diags.push(
      `WARN: activeTeamCount=${N} is not a power of two — round-based BO3 detection may be imprecise`,
    );
  }

  if (rows.length !== expectedTotal) {
    diags.push(
      `WARN: received ${rows.length} rows but expected ${expectedTotal} (formula 2N-2)`,
    );
  }

  const positiveRows = rows.filter((r) => r.round > 0);
  const negativeRows = rows.filter((r) => r.round < 0);

  if (positiveRows.length === 0) {
    diags.push(
      'ERROR: no positive-round matches found — cannot determine GF/UBF',
    );
    return empty(diags);
  }
  if (negativeRows.length === 0) {
    diags.push('ERROR: no negative-round matches found — cannot determine LBF');
    return empty(diags);
  }

  const maxRound = Math.max(...positiveRows.map((r) => r.round));
  const ubfRound = maxRound - 1;
  const lbfRound = Math.min(...negativeRows.map((r) => r.round));

  if (ubfRound < 1) {
    diags.push(
      `ERROR: computed UBF round=${ubfRound} is invalid — bracket has too few UB rounds for N=${N}`,
    );
    return empty(diags);
  }

  const gfMatches = rows.filter((r) => r.round === maxRound);
  const ubfMatches = rows.filter((r) => r.round === ubfRound);
  const lbfMatches = rows.filter((r) => r.round === lbfRound);

  diags.push(
    `Detected finals rounds: GF=${maxRound}(${gfMatches.length} match) ` +
      `UBF=${ubfRound}(${ubfMatches.length} match) LBF=${lbfRound}(${lbfMatches.length} match)`,
  );

  for (const [label, round, matches] of [
    ['GF', maxRound, gfMatches],
    ['UBF', ubfRound, ubfMatches],
    ['LBF', lbfRound, lbfMatches],
  ] as Array<[string, number, typeof gfMatches]>) {
    if (matches.length !== 1) {
      diags.push(
        `WARN: expected exactly 1 match for ${label} (round=${round}), found ${matches.length}`,
      );
    }
  }

  const bo3ChallongeIds = new Set<number>();
  const finalTypeByChallongeId = new Map<number, FinalsSlotKind>();
  const bracketOrdinalByChallongeId = new Map<number, number>();

  const register = (
    matches: readonly BracketRoundedRow[],
    kind: FinalsSlotKind,
    round: number,
  ): void => {
    for (const r of matches) {
      bo3ChallongeIds.add(r.challongeNumericId);
      finalTypeByChallongeId.set(r.challongeNumericId, kind);
      bracketOrdinalByChallongeId.set(r.challongeNumericId, round);
    }
  };

  register(gfMatches, 'grand_final', maxRound);
  register(ubfMatches, 'upper_bracket_final', ubfRound);
  register(lbfMatches, 'lower_bracket_final', lbfRound);

  diags.push(
    `Marked BO3 challonge IDs (${bo3ChallongeIds.size}): ${[...bo3ChallongeIds].sort((a, b) => a - b).join(',')} ` +
      `slotMap=${[...finalTypeByChallongeId.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, slot]) => `${id}:${slot}`)
        .join('; ')}`,
  );

  if (bo3ChallongeIds.size !== PLAYOFF_BO3_FINALS_COUNT) {
    diags.push(
      `ERROR: expected exactly ${PLAYOFF_BO3_FINALS_COUNT} BO3 finals for DE, got ${bo3ChallongeIds.size}`,
    );
  }

  return {
    bo3ChallongeIds,
    finalTypeByChallongeId,
    bracketOrdinalByChallongeId,
    diagnostics: diags,
  };
}

function empty(diagnostics: string[]): ResolvedDeBo3 {
  return {
    bo3ChallongeIds: new Set(),
    finalTypeByChallongeId: new Map(),
    bracketOrdinalByChallongeId: new Map(),
    diagnostics,
  };
}

// ── @deprecated legacy ordinal-based helpers ──────────────────────────────────

/**
 * @deprecated Use resolveDoubleElimFinalsFromRounds instead.
 * The ordinal formula (N−2, 2N−4, 2N−3) does not reliably match
 * Challonge's suggested_play_order numbering across bracket sizes.
 */
export function deFinalsBracketIndices(teamCount: number): {
  upperBracketFinalIndex: number;
  lowerBracketFinalIndex: number;
  grandFinalIndex: number;
} {
  const N = Math.trunc(teamCount);
  return {
    upperBracketFinalIndex: N - 2,
    lowerBracketFinalIndex: 2 * N - 4,
    grandFinalIndex: 2 * N - 3,
  };
}

function parseIdentifierOrdinal(identifier: unknown): number | null {
  if (typeof identifier !== 'string') return null;
  const m = /^M?\s*(\d+)/i.exec(identifier.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

/** @deprecated Use bracketOrdinalFromChallongeMatchAttrs is no longer needed with the round-based resolver. */
export function bracketOrdinalFromChallongeMatchAttrs(
  attributes: Record<string, unknown>,
): number | null {
  const hinted = [
    attributes.suggested_play_order,
    attributes['suggested-play-order'],
    attributes.suggestedPlayOrder,
    attributes.match_sequence,
    attributes['match-sequence'],
  ];
  for (const h of hinted) {
    if (typeof h === 'number' && Number.isFinite(h) && h >= 1)
      return Math.trunc(h);
    if (typeof h === 'string') {
      const k = Number(h.trim());
      if (Number.isFinite(k) && k >= 1) return Math.trunc(k);
    }
  }

  const fromIdent =
    parseIdentifierOrdinal(attributes.identifier) ??
    parseIdentifierOrdinal(attributes.slug);
  if (fromIdent !== null) return fromIdent;

  return null;
}

export interface BracketIndexedRow {
  challongeNumericId: number;
  bracketOrdinal1Based: number | null;
}

/** @deprecated Use resolveDoubleElimFinalsFromRounds instead. */
export function resolveDoubleElimBo3ByBracketOrdinal(
  rows: readonly BracketIndexedRow[],
  activeTeamCount: number,
): ResolvedDeBo3 {
  const diags: string[] = [];

  const N = Math.trunc(activeTeamCount);
  const expectedTotal = expectedDoubleEliminationMatchTotal(N);

  const { upperBracketFinalIndex, lowerBracketFinalIndex, grandFinalIndex } =
    deFinalsBracketIndices(N);
  diags.push(
    `DE sizing: N(active)=${N} expectedTotalMatches=${expectedTotal} ` +
      `formula BO3 ordinal indices UB=${upperBracketFinalIndex} LB=${lowerBracketFinalIndex} GF=${grandFinalIndex}`,
  );

  if (!Number.isFinite(N) || N < 4) {
    diags.push('Skip DE BO3: invalid teamCount (< 4)');
    return empty(diags);
  }

  if (!isPowerOfTwoTeamCount(N)) {
    diags.push(
      `WARN: activeTeamCount=${N} is not a power of two — BO3 index formula is undefined`,
    );
  }

  const withOrd = rows.filter(
    (r) =>
      typeof r.bracketOrdinal1Based === 'number' && r.bracketOrdinal1Based >= 1,
  );

  const ordinalSeen = new Set<number>();
  const byOrdinal = new Map<number, number>();
  for (const r of withOrd) {
    const ord = r.bracketOrdinal1Based!;
    if (ordinalSeen.has(ord)) {
      diags.push(
        `WARN: duplicate bracket ordinal=${ord}; keeping first Challonge id ${byOrdinal.get(ord)}, also saw ${r.challongeNumericId}`,
      );
      continue;
    }
    ordinalSeen.add(ord);
    byOrdinal.set(ord, r.challongeNumericId);
  }

  const missingOrdinalRows = rows.filter(
    (r) => r.bracketOrdinal1Based === null,
  );
  if (missingOrdinalRows.length > 0) {
    diags.push(
      `WARN: ${missingOrdinalRows.length} Challonge rows lack canonical bracket ordinal` +
        ` ids=${missingOrdinalRows
          .map((r) => r.challongeNumericId)
          .sort((a, b) => a - b)
          .slice(0, 12)
          .join(',')}${missingOrdinalRows.length > 12 ? '…' : ''}`,
    );
  }

  if (expectedTotal > 0 && byOrdinal.size !== expectedTotal) {
    diags.push(
      `WARN: ordinal coverage ${byOrdinal.size} !== expected total ${expectedTotal} (formula 2N-2); BO3 marking may mismatch`,
    );
  }

  const bo3Canonical = [
    upperBracketFinalIndex,
    lowerBracketFinalIndex,
    grandFinalIndex,
  ] as const;

  const bo3ChallongeIds = new Set<number>();
  const finalTypeByChallongeId = new Map<number, FinalsSlotKind>();
  const bracketOrdinalByChallongeId = new Map<number, number>();

  for (const ord of bo3Canonical) {
    const cid = byOrdinal.get(ord);
    if (cid === undefined) {
      diags.push(
        `WARN: canonical BO3 ordinal ${ord} (${labelForCanonical(ord, bo3Canonical)}) has no Challonge row`,
      );
      continue;
    }
    bo3ChallongeIds.add(cid);
    finalTypeByChallongeId.set(
      cid,
      ord === upperBracketFinalIndex
        ? 'upper_bracket_final'
        : ord === lowerBracketFinalIndex
          ? 'lower_bracket_final'
          : 'grand_final',
    );
    bracketOrdinalByChallongeId.set(cid, ord);
  }

  diags.push(
    `Marked BO3 challonge IDs (${bo3ChallongeIds.size}): ${[...bo3ChallongeIds].sort((a, b) => a - b).join(',')} ` +
      `slotMap=${[...finalTypeByChallongeId.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, slot]) => `${id}:${slot}`)
        .join('; ')}`,
  );

  if (bo3ChallongeIds.size !== PLAYOFF_BO3_FINALS_COUNT) {
    diags.push(
      `ERROR: expected exactly ${PLAYOFF_BO3_FINALS_COUNT} BO3 finals for DE, got ${bo3ChallongeIds.size}`,
    );
  }

  return {
    bo3ChallongeIds,
    finalTypeByChallongeId,
    bracketOrdinalByChallongeId,
    diagnostics: diags,
  };
}

function labelForCanonical(
  ord: number,
  triple: readonly [number, number, number],
): string {
  if (ord === triple[0]) return 'upper_bracket_final';
  if (ord === triple[1]) return 'lower_bracket_final';
  return 'grand_final';
}
