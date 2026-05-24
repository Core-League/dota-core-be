/**
 * Детерміновані BO3-фінали для подвійної елімінації (N — степінь двійки).
 * Індекси матчів 1..(2N−2) у канонічному порядку Challonge bracket (поле ordinal).
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

/** Загальна кількість матчів у повній DE сітці (один матч GF). */
export function expectedDoubleEliminationMatchTotal(teamCount: number): number {
  const N = Math.trunc(teamCount);
  if (!Number.isFinite(N) || N < 2) return 0;
  return 2 * N - 2;
}

/**
 * UB final = N−2; LB final = 2N−4; GF = 2N−3 — усі значення за 1-based індексом раунду.
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

/** Витяг 1-based canonical bracket ordinal з Challonge Match attributes JSON:API. */
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

export interface ResolvedDeBo3 {
  /** Challonge матч-ids які мають bestOf = 3 */
  bo3ChallongeIds: Set<number>;
  finalTypeByChallongeId: Map<number, FinalsSlotKind>;
  bracketOrdinalByChallongeId: Map<number, number>;
  diagnostics: string[];
}

/** Розв’язати BO3 за зіставленням канонічного порядкового номера Challonge-міси з очікуваними індексами. */
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
    return {
      bo3ChallongeIds: new Set(),
      finalTypeByChallongeId: new Map(),
      bracketOrdinalByChallongeId: new Map(),
      diagnostics: diags,
    };
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

  /** ordinal → один Challonge id */
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
      `WARN: ${missingOrdinalRows.length} Challonge rows lack canonical bracket ordinal (suggested_play_order / identifier)` +
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
