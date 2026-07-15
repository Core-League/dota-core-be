import {
  DIVISION_RULES,
  computeTeamAvgRating,
  isTeamEligibleForDivision,
  resolveTeamDivision,
} from './tournament-division.util';
import { TournamentDivision } from './tournaments.model';

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

describe('DIVISION_RULES', () => {
  it('matches the agreed thresholds', () => {
    expect(DIVISION_RULES[TournamentDivision.DIVISION_I]).toEqual({
      label: 'Початковий',
      minAvg: 0,
      maxAvg: 3500,
      maxPlayerRating: 5500,
    });
    expect(DIVISION_RULES[TournamentDivision.DIVISION_II]).toEqual({
      label: 'Любительський',
      minAvg: 0,
      maxAvg: 7000,
      maxPlayerRating: null,
    });
    expect(DIVISION_RULES[TournamentDivision.DIVISION_III]).toEqual({
      label: 'Аматорський',
      minAvg: 7000,
      maxAvg: null,
      maxPlayerRating: null,
    });
  });
});

describe('isTeamEligibleForDivision', () => {
  it('rejects an empty roster for every division', () => {
    for (const division of Object.values(TournamentDivision)) {
      expect(isTeamEligibleForDivision([], division)).toBe(false);
    }
  });

  it('accepts a low roster under the cap for DIVISION_I', () => {
    expect(
      isTeamEligibleForDivision(
        roster(2000, 2000, 2000, 2000, 2000),
        TournamentDivision.DIVISION_I,
      ),
    ).toBe(true);
  });

  it('treats the 3500 average boundary as inside DIVISION_I', () => {
    expect(
      isTeamEligibleForDivision(
        roster(3500, 3500, 3500, 3500, 3500),
        TournamentDivision.DIVISION_I,
      ),
    ).toBe(true);
    expect(
      isTeamEligibleForDivision(
        roster(3501, 3501, 3501, 3501, 3501),
        TournamentDivision.DIVISION_I,
      ),
    ).toBe(false);
  });

  // The reason this whole change exists: a cheap average must not smuggle in a
  // single very strong player.
  it('rejects DIVISION_I when one player exceeds the 5500 cap, despite a low average', () => {
    const smurfy = roster(500, 500, 500, 500, 6000); // avg 1600 — well inside 0–3500
    expect(
      isTeamEligibleForDivision(smurfy, TournamentDivision.DIVISION_I),
    ).toBe(false);
    expect(
      isTeamEligibleForDivision(smurfy, TournamentDivision.DIVISION_II),
    ).toBe(true);
  });

  it('treats the 5500 player cap boundary as eligible', () => {
    expect(
      isTeamEligibleForDivision(
        roster(500, 500, 500, 500, 5500),
        TournamentDivision.DIVISION_I,
      ),
    ).toBe(true);
    expect(
      isTeamEligibleForDivision(
        roster(500, 500, 500, 500, 5501),
        TournamentDivision.DIVISION_I,
      ),
    ).toBe(false);
  });

  it('ignores the player cap for divisions that have none', () => {
    expect(
      isTeamEligibleForDivision(
        roster(1000, 1000, 1000, 1000, 9000),
        TournamentDivision.DIVISION_II,
      ),
    ).toBe(true);
  });

  it('allows playing up: a weak roster is eligible for both I and II, but not III', () => {
    const weak = roster(2000, 2000, 2000, 2000, 2000);
    expect(isTeamEligibleForDivision(weak, TournamentDivision.DIVISION_I)).toBe(
      true,
    );
    expect(
      isTeamEligibleForDivision(weak, TournamentDivision.DIVISION_II),
    ).toBe(true);
    expect(
      isTeamEligibleForDivision(weak, TournamentDivision.DIVISION_III),
    ).toBe(false);
  });

  it('treats the 7000 average as eligible for BOTH II and III', () => {
    const exactly7000 = roster(7000, 7000, 7000, 7000, 7000);
    expect(
      isTeamEligibleForDivision(exactly7000, TournamentDivision.DIVISION_II),
    ).toBe(true);
    expect(
      isTeamEligibleForDivision(exactly7000, TournamentDivision.DIVISION_III),
    ).toBe(true);
  });

  it('puts an average above 7000 in III only', () => {
    const strong = roster(8000, 8000, 8000, 8000, 8000);
    expect(
      isTeamEligibleForDivision(strong, TournamentDivision.DIVISION_I),
    ).toBe(false);
    expect(
      isTeamEligibleForDivision(strong, TournamentDivision.DIVISION_II),
    ).toBe(false);
    expect(
      isTeamEligibleForDivision(strong, TournamentDivision.DIVISION_III),
    ).toBe(true);
  });
});

describe('resolveTeamDivision', () => {
  it('returns null only for an empty roster', () => {
    expect(resolveTeamDivision([])).toBeNull();
  });

  it('returns the lowest matching division', () => {
    expect(resolveTeamDivision(roster(2000, 2000, 2000, 2000, 2000))).toBe(
      TournamentDivision.DIVISION_I,
    );
    expect(resolveTeamDivision(roster(5000, 5000, 5000, 5000, 5000))).toBe(
      TournamentDivision.DIVISION_II,
    );
    expect(resolveTeamDivision(roster(8000, 8000, 8000, 8000, 8000))).toBe(
      TournamentDivision.DIVISION_III,
    );
  });

  it('resolves an exactly-7000 average to II, the lower of its two matches', () => {
    expect(resolveTeamDivision(roster(7000, 7000, 7000, 7000, 7000))).toBe(
      TournamentDivision.DIVISION_II,
    );
  });

  it('demotes a capped-out roster to II even though its average fits I', () => {
    expect(resolveTeamDivision(roster(500, 500, 500, 500, 6000))).toBe(
      TournamentDivision.DIVISION_II,
    );
  });

  it('always resolves a non-empty roster', () => {
    const samples = [roster(0), roster(3500), roster(7000), roster(99999)];
    for (const sample of samples) {
      expect(resolveTeamDivision(sample)).not.toBeNull();
    }
  });
});
