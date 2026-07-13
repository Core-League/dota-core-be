import { computeTeamDivision } from './tournament-division.util';
import { TournamentDivision } from './tournaments.model';

const roster = (...ratings: number[]) => ratings.map((rating) => ({ rating }));

describe('computeTeamDivision (average-only, two divisions)', () => {
  it('returns null for an empty roster', () => {
    expect(computeTeamDivision([])).toBeNull();
  });

  it('classifies an average at or below 6500 as DIVISION_I', () => {
    expect(computeTeamDivision(roster(6000, 6000, 6000, 6000, 6000))).toBe(
      TournamentDivision.DIVISION_I,
    );
  });

  it('treats the 6500 boundary as DIVISION_I', () => {
    expect(computeTeamDivision(roster(6500, 6500, 6500, 6500, 6500))).toBe(
      TournamentDivision.DIVISION_I,
    );
  });

  it('classifies an average above 6500 as DIVISION_II', () => {
    expect(computeTeamDivision(roster(6501, 6501, 6501, 6501, 6501))).toBe(
      TournamentDivision.DIVISION_II,
    );
    expect(computeTeamDivision(roster(8000, 8000, 8000, 8000, 8000))).toBe(
      TournamentDivision.DIVISION_II,
    );
  });

  it('ignores any per-player ceiling — only the average matters', () => {
    // avg 6000 (DIV I) even though one player is far above the retired 5500 cap.
    expect(computeTeamDivision(roster(4000, 5000, 6000, 7000, 8000))).toBe(
      TournamentDivision.DIVISION_I,
    );
  });

  it('never produces the retired DIVISION_III', () => {
    const sampled = [
      roster(1000, 1000, 1000, 1000, 1000),
      roster(6500, 6500, 6500, 6500, 6500),
      roster(9000, 9000, 9000, 9000, 9000),
    ].map(computeTeamDivision);
    expect(sampled).not.toContain(TournamentDivision.DIVISION_III);
  });
});
