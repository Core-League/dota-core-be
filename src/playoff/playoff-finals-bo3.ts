/**
 * Finals detection from Challonge round numbers.
 *
 * Every regular bracket node is a BO1. Only the finals slots carry a
 * configurable series length — BO1, BO3 or BO5 per slot, set on the tournament
 * (`FinalsBestOf`). The resolvers here find the slots; the series length is then
 * looked up per slot kind, so the engine never assumes a finals slot is BO3.
 *
 * Double elimination (round-based, preferred):
 *   resolveDoubleElimFinalsFromRounds — uses Challonge round numbers to
 *   deterministically identify UBF, LBF and GF for any N.
 *
 *   Challonge assigns positive round numbers to upper-bracket matches and
 *   negative round numbers to lower-bracket matches:
 *     GF  = match with the highest positive round
 *     UBF = match with round = GF.round − 1  (last UB round before GF)
 *     LBF = match with the most negative round  (last LB round)
 *
 * Single elimination:
 *   resolveSingleElimFinalsFromRounds — the final sits at the highest round;
 *   there is no lower bracket. With a third-place match Challonge places a
 *   second node at that same round; it stays BO1 and is never a final.
 *
 * `bracket-format.strategy.ts` picks the resolver for a tournament's format.
 */

import { type FinalsBestOf } from '../tournaments/tournament-bracket.util';
import { type SeriesBestOf } from '../tournaments/tournaments.model';

export type FinalsSlotKind =
  | 'upper_bracket_final'
  | 'lower_bracket_final'
  | 'grand_final';

/** Finals slots of a double-elimination bracket: UBF, LBF and GF. */
export const PLAYOFF_DE_FINALS_COUNT = 3;

/** A single-elimination bracket has exactly one finals slot: the final. */
export const PLAYOFF_SE_FINALS_COUNT = 1;

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

export interface ResolvedFinals {
  /** Challonge match IDs of every finals slot, whatever its series length. */
  finalsChallongeIds: Set<number>;
  finalTypeByChallongeId: Map<number, FinalsSlotKind>;
  /** Series length of each finals slot, from the tournament's finals config. */
  bestOfByChallongeId: Map<number, SeriesBestOf>;
  /** Stores the Challonge round number for each finals match (diagnostic use). */
  bracketOrdinalByChallongeId: Map<number, number>;
  diagnostics: string[];
}

// ── Round-based resolver (preferred) ─────────────────────────────────────────

export interface BracketRoundedRow {
  challongeNumericId: number;
  /** Challonge round: positive = upper bracket, negative = lower bracket, max positive = GF. */
  round: number;
}

interface FinalsSlot {
  row: BracketRoundedRow;
  kind: FinalsSlotKind;
  round: number;
}

/**
 * Identify UBF, LBF and GF from Challonge round numbers.
 * Works for any power-of-two N ≥ 4 without hard-coded index formulas.
 */
export function resolveDoubleElimFinalsFromRounds(
  rows: readonly BracketRoundedRow[],
  activeTeamCount: number,
  finalsBestOf: FinalsBestOf,
): ResolvedFinals {
  const diags: string[] = [];
  const N = Math.trunc(activeTeamCount);
  const expectedTotal = expectedDoubleEliminationMatchTotal(N);

  diags.push(
    `DE sizing: N(active)=${N} expectedTotalMatches=${expectedTotal} strategy=round-based ` +
      `finals=${describeFinalsBestOf(finalsBestOf)}`,
  );

  if (!Number.isFinite(N) || N < 3) {
    diags.push('Skip DE finals: invalid teamCount (< 3)');
    return empty(diags);
  }

  if (!isPowerOfTwoTeamCount(N)) {
    diags.push(
      `WARN: activeTeamCount=${N} is not a power of two — round-based finals detection may be imprecise`,
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

  // When Challonge creates a bracket-reset slot, there are 2 matches at the max round.
  // Only the one with the lowest numeric ID is the real GF; the reset slot is never
  // played with grand_finals_modifier: 'single match'.
  const effectiveGfMatches =
    gfMatches.length > 1
      ? [
          gfMatches.reduce((a, b) =>
            a.challongeNumericId < b.challongeNumericId ? a : b,
          ),
        ]
      : gfMatches;

  const slots: FinalsSlot[] = [
    ...effectiveGfMatches.map((row) => ({
      row,
      kind: 'grand_final' as const,
      round: maxRound,
    })),
    ...ubfMatches.map((row) => ({
      row,
      kind: 'upper_bracket_final' as const,
      round: ubfRound,
    })),
    ...lbfMatches.map((row) => ({
      row,
      kind: 'lower_bracket_final' as const,
      round: lbfRound,
    })),
  ];

  const resolved = fromSlots(slots, finalsBestOf, diags);

  if (resolved.finalsChallongeIds.size !== PLAYOFF_DE_FINALS_COUNT) {
    diags.push(
      `ERROR: expected exactly ${PLAYOFF_DE_FINALS_COUNT} finals slots for DE, got ${resolved.finalsChallongeIds.size}`,
    );
  }

  return resolved;
}

// ── Single-elimination resolver ───────────────────────────────────────────────

/**
 * Total matches in a single-elimination bracket: N − 1, plus one node when a
 * third-place match is held. A third-place match needs two semifinal losers,
 * so it only exists for N ≥ 4 — Challonge holds none for a two-team bracket.
 */
export function expectedSingleEliminationMatchTotal(
  teamCount: number,
  hasThirdPlaceMatch = false,
): number {
  const N = Math.trunc(teamCount);
  if (!Number.isFinite(N) || N < 2) return 0;
  return N - 1 + (hasThirdPlaceMatch && N >= 4 ? 1 : 0);
}

/**
 * Identify the final of a single-elimination bracket from Challonge round numbers.
 *
 * Every node carries a positive round; the final sits at the highest round.
 * Typed `grand_final` on purpose so the frontend contract does not grow a
 * fourth `FinalsSlotKind`; its series length is `finalsBestOf.grand_final`.
 * For N = 2 the only node is the final.
 *
 * With `hasThirdPlaceMatch` Challonge adds the third-place match at the same
 * round as the final, so two nodes share the top round. The final is the one
 * with the lowest numeric id (Challonge numbers the main bracket first and
 * appends the consolation node); the other node is left as a regular BO1 slot.
 */
export function resolveSingleElimFinalsFromRounds(
  rows: readonly BracketRoundedRow[],
  activeTeamCount: number,
  finalsBestOf: FinalsBestOf,
  hasThirdPlaceMatch = false,
): ResolvedFinals {
  const diags: string[] = [];
  const N = Math.trunc(activeTeamCount);
  const expectedTotal = expectedSingleEliminationMatchTotal(
    N,
    hasThirdPlaceMatch,
  );

  diags.push(
    `SE sizing: N(active)=${N} thirdPlaceMatch=${hasThirdPlaceMatch} ` +
      `expectedTotalMatches=${expectedTotal} strategy=round-based final=bo${finalsBestOf.grand_final}`,
  );

  if (!Number.isFinite(N) || N < 2) {
    diags.push('Skip SE finals: invalid teamCount (< 2)');
    return empty(diags);
  }

  if (!isPowerOfTwoTeamCount(N)) {
    diags.push(
      `WARN: activeTeamCount=${N} is not a power of two — Challonge fills the bracket with byes`,
    );
  }

  if (rows.length !== expectedTotal) {
    diags.push(
      `WARN: received ${rows.length} rows but expected ${expectedTotal} ` +
        `(formula N-1${hasThirdPlaceMatch ? ' + third-place match' : ''})`,
    );
  }

  const positiveRows = rows.filter((r) => r.round > 0);
  if (positiveRows.length === 0) {
    diags.push(
      'ERROR: no positive-round matches found — cannot determine final',
    );
    return empty(diags);
  }

  const negativeRows = rows.filter((r) => r.round < 0);
  if (negativeRows.length > 0) {
    diags.push(
      `WARN: ${negativeRows.length} negative-round matches in a single-elimination bracket — ignored`,
    );
  }

  const maxRound = Math.max(...positiveRows.map((r) => r.round));
  const finalMatches = positiveRows.filter((r) => r.round === maxRound);

  diags.push(
    `Detected final round: F=${maxRound}(${finalMatches.length} match)`,
  );

  // A third-place match shares the top round with the final, so exactly two
  // nodes sit there when it is held (and N ≥ 4); otherwise exactly one. The
  // lowest numeric id is always the real final.
  const expectedTopNodes = hasThirdPlaceMatch && N >= 4 ? 2 : 1;
  if (finalMatches.length !== expectedTopNodes) {
    diags.push(
      `WARN: expected ${expectedTopNodes} match(es) at the top round (round=${maxRound}), found ${finalMatches.length}`,
    );
  }
  const finalNode = finalMatches.reduce((a, b) =>
    a.challongeNumericId < b.challongeNumericId ? a : b,
  );
  if (hasThirdPlaceMatch) {
    const thirdPlaceNodes = finalMatches.filter((r) => r !== finalNode);
    diags.push(
      thirdPlaceNodes.length > 0
        ? `Third-place match node(s) left BO1: ${thirdPlaceNodes
            .map((r) => r.challongeNumericId)
            .sort((a, b) => a - b)
            .join(',')}`
        : 'WARN: third-place match requested but no second node at the top round',
    );
  }

  return fromSlots(
    [{ row: finalNode, kind: 'grand_final', round: maxRound }],
    finalsBestOf,
    diags,
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** `ubf=bo3,lbf=bo1,gf=bo5` — for log lines. */
export function describeFinalsBestOf(finalsBestOf: FinalsBestOf): string {
  return (
    `ubf=bo${finalsBestOf.upper_bracket_final},` +
    `lbf=bo${finalsBestOf.lower_bracket_final},` +
    `gf=bo${finalsBestOf.grand_final}`
  );
}

/** Builds the resolver output from the detected slots and the per-slot series lengths. */
function fromSlots(
  slots: readonly FinalsSlot[],
  finalsBestOf: FinalsBestOf,
  diags: string[],
): ResolvedFinals {
  const finalsChallongeIds = new Set<number>();
  const finalTypeByChallongeId = new Map<number, FinalsSlotKind>();
  const bestOfByChallongeId = new Map<number, SeriesBestOf>();
  const bracketOrdinalByChallongeId = new Map<number, number>();

  for (const { row, kind, round } of slots) {
    finalsChallongeIds.add(row.challongeNumericId);
    finalTypeByChallongeId.set(row.challongeNumericId, kind);
    bestOfByChallongeId.set(row.challongeNumericId, finalsBestOf[kind]);
    bracketOrdinalByChallongeId.set(row.challongeNumericId, round);
  }

  diags.push(
    `Marked finals challonge IDs (${finalsChallongeIds.size}): ${[...finalsChallongeIds].sort((a, b) => a - b).join(',')} ` +
      `slotMap=${[...finalTypeByChallongeId.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, slot]) => `${id}:${slot}:bo${bestOfByChallongeId.get(id)}`)
        .join('; ')}`,
  );

  return {
    finalsChallongeIds,
    finalTypeByChallongeId,
    bestOfByChallongeId,
    bracketOrdinalByChallongeId,
    diagnostics: diags,
  };
}

function empty(diagnostics: string[]): ResolvedFinals {
  return {
    finalsChallongeIds: new Set(),
    finalTypeByChallongeId: new Map(),
    bestOfByChallongeId: new Map(),
    bracketOrdinalByChallongeId: new Map(),
    diagnostics,
  };
}

// ── @deprecated legacy ordinal helpers ────────────────────────────────────────

function parseIdentifierOrdinal(identifier: unknown): number | null {
  if (typeof identifier !== 'string') return null;
  const m = /^M?\s*(\d+)/i.exec(identifier.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

/** @deprecated No longer needed with the round-based resolver; kept for `listBracketIndexedMatches`. */
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
