import { TournamentBracketType } from '../tournaments/tournaments.model';
import type { PlayoffFinalType } from './playoff-series.entity';

/**
 * The slice of a persisted `playoff_series` row that final standings depend on.
 * Everything here is written by Core when a series is decided (submit / tech
 * loss), so placements never need a Challonge round-trip.
 */
export interface PlacementSeriesRow {
  id: string;
  finalType: PlayoffFinalType | null;
  teamAId: string | null;
  teamBId: string | null;
  seriesWinnerId: string | null;
}

export type PlayoffPlace = 1 | 2 | 3;

export interface PlayoffPlacementIds {
  place: PlayoffPlace;
  teamId: string;
}

export interface PlacementBracketOptions {
  bracketType: TournamentBracketType;
  hasThirdPlaceMatch: boolean;
}

function loserOf(series: PlacementSeriesRow): string | null {
  const { teamAId, teamBId, seriesWinnerId } = series;
  if (!seriesWinnerId) return null;
  if (teamAId === seriesWinnerId) return teamBId;
  if (teamBId === seriesWinnerId) return teamAId;
  return null;
}

/**
 * Single elimination: the third-place match is the only series (other than
 * the final) played between two teams that each lost to a finalist. Finalists
 * never lose before the final, so no other pairing can match that shape, and
 * no round number is needed.
 */
function thirdPlaceFromConsolationMatch(
  series: readonly PlacementSeriesRow[],
  grandFinal: PlacementSeriesRow,
): string | null {
  const finalistIds = new Set(
    [grandFinal.teamAId, grandFinal.teamBId].filter((id): id is string => !!id),
  );
  const lostToFinalist = new Set<string>();
  for (const s of series) {
    if (s.id === grandFinal.id || !s.seriesWinnerId) continue;
    if (!finalistIds.has(s.seriesWinnerId)) continue;
    const loser = loserOf(s);
    if (loser) lostToFinalist.add(loser);
  }

  const consolation = series.find(
    (s) =>
      s.id !== grandFinal.id &&
      !!s.teamAId &&
      !!s.teamBId &&
      lostToFinalist.has(s.teamAId) &&
      lostToFinalist.has(s.teamBId),
  );
  return consolation?.seriesWinnerId ?? null;
}

function deriveThirdPlace(
  series: readonly PlacementSeriesRow[],
  grandFinal: PlacementSeriesRow,
  opts: PlacementBracketOptions,
): string | null {
  if (opts.bracketType === TournamentBracketType.DOUBLE_ELIMINATION) {
    const lowerFinal = series.find(
      (s) => s.finalType === 'lower_bracket_final',
    );
    return lowerFinal ? loserOf(lowerFinal) : null;
  }
  if (!opts.hasThirdPlaceMatch) return null;
  return thirdPlaceFromConsolationMatch(series, grandFinal);
}

/**
 * Final standings (1st–3rd) of a playoff, read purely from persisted series.
 * Empty until the grand final has a winner. Brackets are created with the
 * "single match" grand-final modifier, so there is exactly one grand final.
 */
export function derivePlayoffPlacementIds(
  series: readonly PlacementSeriesRow[],
  opts: PlacementBracketOptions,
): PlayoffPlacementIds[] {
  const grandFinal = series.find((s) => s.finalType === 'grand_final');
  if (!grandFinal?.seriesWinnerId) return [];

  const champion = grandFinal.seriesWinnerId;
  const runnerUp = loserOf(grandFinal);
  if (!runnerUp) return [];

  const placements: PlayoffPlacementIds[] = [
    { place: 1, teamId: champion },
    { place: 2, teamId: runnerUp },
  ];

  const third = deriveThirdPlace(series, grandFinal, opts);
  if (third && third !== champion && third !== runnerUp) {
    placements.push({ place: 3, teamId: third });
  }
  return placements;
}
