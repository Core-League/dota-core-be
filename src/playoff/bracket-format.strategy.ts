import {
  type SeriesBestOf,
  TournamentBracketType,
} from '../tournaments/tournaments.model';
import {
  type FinalsBestOf,
  type TBracketConfig,
  finalsBestOfFromConfig,
} from '../tournaments/tournament-bracket.util';
import {
  type BracketRoundedRow,
  type ResolvedFinals,
  PLAYOFF_DE_FINALS_COUNT,
  PLAYOFF_SE_FINALS_COUNT,
  describeFinalsBestOf,
  expectedDoubleEliminationMatchTotal,
  expectedSingleEliminationMatchTotal,
  resolveDoubleElimFinalsFromRounds,
  resolveSingleElimFinalsFromRounds,
} from './playoff-finals-bo3';

/**
 * Challonge v2.1 tournament attributes that differ per bracket format. Spread
 * into the `attributes` object of the create-tournament request.
 */
export interface ChallongeBracketAttributes {
  tournament_type: 'single elimination' | 'double elimination';
  double_elimination_options?: { grand_finals_modifier: 'single match' };
  /**
   * Consolation (placement) matches down to the given final rank; `3` adds the
   * third-place match. Omitted entirely when no placement match is wanted —
   * Challonge holds none unless asked.
   */
  match_options?: { consolation_matches_target_rank: number };
}

/** Challonge's rank for "break the tie for third place", i.e. a third-place match. */
const CHALLONGE_THIRD_PLACE_TARGET_RANK = 3;

/**
 * The finals series lengths actually in play for a bracket shape. Upper- and
 * lower-bracket finals only exist in double elimination, so they are `null`
 * for single elimination; `grandFinal` is the grand final in double
 * elimination and the final in single elimination.
 */
export interface EffectiveFinalsBestOf {
  upperBracketFinal: SeriesBestOf | null;
  lowerBracketFinal: SeriesBestOf | null;
  grandFinal: SeriesBestOf;
}

/**
 * Everything the playoff engine needs to know about a bracket shape. Built from
 * the tournament's `bracketType`, `hasThirdPlaceMatch` and the three finals
 * series lengths; answers exactly three questions:
 *
 * 1. how to create the Challonge bracket;
 * 2. which bracket nodes are finals slots, of which kind and of which series
 *    length, given the Challonge round rows and the active team count;
 * 3. what node count and finals count to expect, for diagnostics.
 *
 * Nothing else in the engine branches on the shape — match recording, series
 * closing, replay and teardown read `PlayoffSeries.bestOf` instead.
 */
export interface BracketFormatStrategy {
  readonly bracketType: TournamentBracketType;
  /** Whether the bracket holds a third-place match (single elimination only). */
  readonly hasThirdPlaceMatch: boolean;
  /** Series length per finals slot, as configured on the tournament. */
  readonly finalsBestOf: FinalsBestOf;
  /** Short tag used in log lines, e.g. `DE(ubf=bo3,lbf=bo1,gf=bo5)` / `SE+3rd(f=bo3)`. */
  readonly label: string;
  challongeAttributes(): ChallongeBracketAttributes;
  resolveFinals(
    rows: readonly BracketRoundedRow[],
    activeTeamCount: number,
  ): ResolvedFinals;
  expectedNodeCount(activeTeamCount: number): number;
  /** Finals slots a healthy bracket of this size has; 0 when too small to have any. */
  expectedFinalsCount(activeTeamCount: number): number;
  /** The finals series lengths that apply to this shape (see `EffectiveFinalsBestOf`). */
  effectiveFinalsBestOf(): EffectiveFinalsBestOf;
}

function doubleElimination(finalsBestOf: FinalsBestOf): BracketFormatStrategy {
  return {
    bracketType: TournamentBracketType.DOUBLE_ELIMINATION,
    // Third place is the lower-bracket final's loser; there is no extra node to hold.
    hasThirdPlaceMatch: false,
    finalsBestOf,
    label: `DE(${describeFinalsBestOf(finalsBestOf)})`,
    challongeAttributes: () => ({
      tournament_type: 'double elimination',
      double_elimination_options: { grand_finals_modifier: 'single match' },
    }),
    resolveFinals: (rows, n) =>
      resolveDoubleElimFinalsFromRounds(rows, n, finalsBestOf),
    expectedNodeCount: expectedDoubleEliminationMatchTotal,
    // UBF, LBF and GF need a lower bracket, which needs at least three teams.
    expectedFinalsCount: (n) =>
      Math.trunc(n) >= 3 ? PLAYOFF_DE_FINALS_COUNT : 0,
    effectiveFinalsBestOf: () => ({
      upperBracketFinal: finalsBestOf.upper_bracket_final,
      lowerBracketFinal: finalsBestOf.lower_bracket_final,
      grandFinal: finalsBestOf.grand_final,
    }),
  };
}

function singleElimination(
  hasThirdPlaceMatch: boolean,
  finalsBestOf: FinalsBestOf,
): BracketFormatStrategy {
  return {
    bracketType: TournamentBracketType.SINGLE_ELIMINATION,
    hasThirdPlaceMatch,
    finalsBestOf,
    label: `${hasThirdPlaceMatch ? 'SE+3rd' : 'SE'}(f=bo${finalsBestOf.grand_final})`,
    challongeAttributes: () => ({
      tournament_type: 'single elimination',
      ...(hasThirdPlaceMatch && {
        match_options: {
          consolation_matches_target_rank: CHALLONGE_THIRD_PLACE_TARGET_RANK,
        },
      }),
    }),
    resolveFinals: (rows, n) =>
      resolveSingleElimFinalsFromRounds(
        rows,
        n,
        finalsBestOf,
        hasThirdPlaceMatch,
      ),
    expectedNodeCount: (n) =>
      expectedSingleEliminationMatchTotal(n, hasThirdPlaceMatch),
    // Two teams already make a final. The third-place match is a regular BO1
    // node, so it never counts here.
    expectedFinalsCount: (n) =>
      Math.trunc(n) >= 2 ? PLAYOFF_SE_FINALS_COUNT : 0,
    // Only the final exists; the upper/lower values on the row are unused.
    effectiveFinalsBestOf: () => ({
      upperBracketFinal: null,
      lowerBracketFinal: null,
      grandFinal: finalsBestOf.grand_final,
    }),
  };
}

/**
 * Strategy for a tournament's bracket shape. `config` is normally the
 * tournament row (or a `select` of it with all five columns);
 * `hasThirdPlaceMatch` is ignored for double elimination, where
 * `validateBracketConfig` already forbids it, and the upper/lower finals
 * lengths are ignored for single elimination, which has only the final.
 */
export function getBracketFormatStrategy(
  config: TBracketConfig,
): BracketFormatStrategy {
  const finalsBestOf = finalsBestOfFromConfig(config);
  switch (config.bracketType) {
    case TournamentBracketType.DOUBLE_ELIMINATION:
      return doubleElimination(finalsBestOf);
    case TournamentBracketType.SINGLE_ELIMINATION:
      return singleElimination(config.hasThirdPlaceMatch, finalsBestOf);
    default:
      throw new Error(`Unknown bracket type: ${String(config.bracketType)}`);
  }
}
