import { TournamentBracketType } from '../tournaments/tournaments.model';
import {
  derivePlayoffPlacementIds,
  type PlacementSeriesRow,
} from './playoff-placements';

function series(
  id: string,
  teamAId: string,
  teamBId: string,
  seriesWinnerId: string | null,
  finalType: PlacementSeriesRow['finalType'] = null,
): PlacementSeriesRow {
  return { id, finalType, teamAId, teamBId, seriesWinnerId };
}

describe('derivePlayoffPlacementIds', () => {
  const DE = {
    bracketType: TournamentBracketType.DOUBLE_ELIMINATION,
    hasThirdPlaceMatch: false,
  };
  const SE = {
    bracketType: TournamentBracketType.SINGLE_ELIMINATION,
    hasThirdPlaceMatch: false,
  };
  const SE_3RD = { ...SE, hasThirdPlaceMatch: true };

  it('is empty until the grand final has a winner', () => {
    const rows = [
      series('ubf', 'A', 'B', 'A', 'upper_bracket_final'),
      series('lbf', 'B', 'C', 'C', 'lower_bracket_final'),
      series('gf', 'A', 'C', null, 'grand_final'),
    ];
    expect(derivePlayoffPlacementIds(rows, DE)).toEqual([]);
  });

  it('double elimination: GF winner, GF loser, lower-bracket-final loser', () => {
    const rows = [
      series('ubf', 'A', 'B', 'A', 'upper_bracket_final'),
      series('lbf', 'B', 'C', 'C', 'lower_bracket_final'),
      series('gf', 'A', 'C', 'C', 'grand_final'),
    ];
    expect(derivePlayoffPlacementIds(rows, DE)).toEqual([
      { place: 1, teamId: 'C' },
      { place: 2, teamId: 'A' },
      { place: 3, teamId: 'B' },
    ]);
  });

  it('single elimination without a third-place match yields two places', () => {
    const rows = [
      series('sf1', 'A', 'B', 'A'),
      series('sf2', 'C', 'D', 'D'),
      series('gf', 'A', 'D', 'A', 'grand_final'),
    ];
    expect(derivePlayoffPlacementIds(rows, SE)).toEqual([
      { place: 1, teamId: 'A' },
      { place: 2, teamId: 'D' },
    ]);
  });

  it('single elimination: third place is the consolation-match winner', () => {
    const rows = [
      series('qf1', 'A', 'E', 'A'),
      series('qf2', 'B', 'F', 'B'),
      series('sf1', 'A', 'B', 'A'),
      series('sf2', 'C', 'D', 'D'),
      series('third', 'B', 'C', 'C'),
      series('gf', 'A', 'D', 'A', 'grand_final'),
    ];
    expect(derivePlayoffPlacementIds(rows, SE_3RD)).toEqual([
      { place: 1, teamId: 'A' },
      { place: 2, teamId: 'D' },
      { place: 3, teamId: 'C' },
    ]);
  });

  it('single elimination: unresolved third-place match leaves two places', () => {
    const rows = [
      series('sf1', 'A', 'B', 'A'),
      series('sf2', 'C', 'D', 'D'),
      series('third', 'B', 'C', null),
      series('gf', 'A', 'D', 'D', 'grand_final'),
    ];
    expect(derivePlayoffPlacementIds(rows, SE_3RD)).toEqual([
      { place: 1, teamId: 'D' },
      { place: 2, teamId: 'A' },
    ]);
  });
});
