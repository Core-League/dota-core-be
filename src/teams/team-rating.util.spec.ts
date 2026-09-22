import { computeTeamAvgRating } from './team-rating.util';

const roster = (...ratings: number[]) => ratings.map((rating) => ({ rating }));

describe('computeTeamAvgRating', () => {
  it('returns null for an empty roster', () => {
    expect(computeTeamAvgRating([])).toBeNull();
  });

  it('averages the roster without rounding', () => {
    expect(computeTeamAvgRating(roster(1000, 2000, 3000, 4000, 5000))).toBe(
      3000,
    );
    expect(computeTeamAvgRating(roster(1, 2))).toBe(1.5);
  });
});
