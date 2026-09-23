import { BadRequestException } from '@nestjs/common';
import { type SeriesBestOf, TournamentBracketType } from './tournaments.model';

/**
 * The tournament fields that together describe the playoff bracket shape.
 * Structural rather than `Pick<Tournament, …>` so the create DTO (after
 * defaults are applied), the entity and a `select`-ed partial all satisfy it.
 */
export type TBracketConfig = {
  bracketType: TournamentBracketType;
  hasThirdPlaceMatch: boolean;
  upperBracketFinalBestOf: SeriesBestOf;
  lowerBracketFinalBestOf: SeriesBestOf;
  grandFinalBestOf: SeriesBestOf;
};

/**
 * Series length per finals slot, keyed by the slot kind the playoff engine
 * uses (`FinalsSlotKind` / `PlayoffFinalType`), so a resolver can look up
 * `finalsBestOf[kind]` directly.
 */
export type FinalsBestOf = {
  upper_bracket_final: SeriesBestOf;
  lower_bracket_final: SeriesBestOf;
  grand_final: SeriesBestOf;
};

/** The three per-slot columns of the tournament row as one `FinalsBestOf`. */
export function finalsBestOfFromConfig(config: TBracketConfig): FinalsBestOf {
  return {
    upper_bracket_final: config.upperBracketFinalBestOf,
    lower_bracket_final: config.lowerBracketFinalBestOf,
    grand_final: config.grandFinalBestOf,
  };
}

/**
 * First broken rule, or null when the bracket configuration is coherent.
 *
 * A third-place match only exists in single elimination: in double elimination
 * third place is already decided by the lower-bracket final, so Challonge has
 * nothing to add and the flag would silently mean nothing.
 *
 * The finals series lengths need no cross-field rule: every combination of
 * BO1/BO3 is a valid bracket. In single elimination the upper- and
 * lower-bracket-final values are simply unused (there is only the final).
 */
export function getBracketConfigViolation(
  config: TBracketConfig,
): string | null {
  if (
    config.hasThirdPlaceMatch &&
    config.bracketType !== TournamentBracketType.SINGLE_ELIMINATION
  ) {
    return 'Матч за третє місце доступний лише для сітки single elimination';
  }
  return null;
}

/** Throws a 400 with a Ukrainian message when the bracket config is incoherent. */
export function validateBracketConfig(config: TBracketConfig): void {
  const violation = getBracketConfigViolation(config);
  if (violation) throw new BadRequestException(violation);
}
