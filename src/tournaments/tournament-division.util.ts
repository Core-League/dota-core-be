import { TournamentDivision } from './tournaments.model';
import { computeTeamAvgRating } from '../teams/team-rating.util';

export interface DivisionRule {
  /** Ukrainian display label. */
  label: string;
  /** Inclusive lower bound on the roster's average rating. */
  minAvg: number;
  /** Inclusive upper bound on the average; null means unbounded. */
  maxAvg: number | null;
  /** Inclusive per-player ceiling; null means no cap. */
  maxPlayerRating: number | null;
}

/**
 * The single source of truth for division thresholds. Bounds are inclusive on
 * both ends, so an average of exactly 7000 satisfies BOTH DIVISION_II and
 * DIVISION_III — harmless, because a team may play up and its displayed
 * division is the lowest match.
 *
 * Note "Аматорський" is the HIGHEST tier here. It used to be the lowest.
 */
export const DIVISION_RULES: Record<TournamentDivision, DivisionRule> = {
  [TournamentDivision.DIVISION_I]: {
    label: 'Початковий',
    minAvg: 0,
    maxAvg: 3500,
    maxPlayerRating: 5500,
  },
  [TournamentDivision.DIVISION_II]: {
    label: 'Любительський',
    minAvg: 0,
    maxAvg: 7000,
    maxPlayerRating: null,
  },
  [TournamentDivision.DIVISION_III]: {
    label: 'Аматорський',
    minAvg: 7000,
    maxAvg: null,
    maxPlayerRating: null,
  },
};

/** Ascending by strength. Order matters: resolveTeamDivision returns the first match. */
const DIVISIONS_BY_STRENGTH: readonly TournamentDivision[] = [
  TournamentDivision.DIVISION_I,
  TournamentDivision.DIVISION_II,
  TournamentDivision.DIVISION_III,
];

/**
 * Whether a roster may enter a tournament in `division`. This — not the team's
 * own resolved division — is the authority for joining, which is what allows a
 * team to play up into a stronger division.
 */
export function isTeamEligibleForDivision(
  players: { rating: number }[],
  division: TournamentDivision,
): boolean {
  const avg = computeTeamAvgRating(players);
  if (avg === null) return false;

  const rule = DIVISION_RULES[division];
  if (avg < rule.minAvg) return false;
  if (rule.maxAvg !== null && avg > rule.maxAvg) return false;

  // Bound to a local so TypeScript narrows it inside the closure.
  const cap = rule.maxPlayerRating;
  if (cap !== null && players.some((p) => p.rating > cap)) return false;

  return true;
}

/**
 * The LOWEST division a roster qualifies for — display and Discord category
 * only, never eligibility. Every non-empty roster matches at least one division
 * (DIVISION_II takes any average ≤ 7000; DIVISION_III takes everything from
 * 7000 up), so null means an empty roster and nothing else.
 */
export function resolveTeamDivision(
  players: { rating: number }[],
): TournamentDivision | null {
  if (!players.length) return null;
  return (
    DIVISIONS_BY_STRENGTH.find((division) =>
      isTeamEligibleForDivision(players, division),
    ) ?? null
  );
}
