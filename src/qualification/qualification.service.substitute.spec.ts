import { BadRequestException } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import { TournamentDivision } from '../tournaments/tournaments.model';
import type { Player } from '../players/player.entity';

/**
 * Focused unit tests for the substitution rule: a reserve is valid only if the
 * roster stays eligible for the TOURNAMENT's division no matter which main
 * player it replaces (see tournament-division.util.ts DIVISION_RULES for the
 * three-tier thresholds: DIVISION_I maxAvg 3500 / cap 5500, DIVISION_II maxAvg
 * 7000 / no cap, DIVISION_III minAvg 7000 / no cap). The two-sided check must
 * guard both the up-move (replace weakest -> highest avg) and the down-move
 * (replace strongest -> lowest avg), plus the flat per-player cap.
 */
describe('QualificationService.validateSubstitute (two-sided division guard)', () => {
  type SubstituteSurface = {
    validateSubstitute(
      mainPlayers: Player[],
      sub: Player,
      division: TournamentDivision,
    ): void;
  };

  const service = new QualificationService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  ) as unknown as SubstituteSurface;

  const players = (...ratings: number[]): Player[] =>
    ratings.map((rating, i) => ({ id: `p${i}`, rating }) as unknown as Player);
  const sub = (rating: number): Player =>
    ({ id: 'sub', rating }) as unknown as Player;

  const validate = (
    main: Player[],
    reserve: Player,
    division: TournamentDivision,
  ) => service.validateSubstitute(main, reserve, division);

  it('allows a comparable reserve that keeps a DIVISION_I team in range and under cap', () => {
    expect(() =>
      validate(
        players(3000, 3000, 3000, 3000, 3000),
        sub(3200),
        TournamentDivision.DIVISION_I,
      ),
    ).not.toThrow();
  });

  it('rejects a reserve that exceeds the per-player cap even though the post-swap average stays in range', () => {
    // Original roster: avg 500, every starter at 500 <= cap 5500 -> eligible
    // for DIVISION_I on its own. Sub is 6000, over the 5500 cap. Because every
    // starter is equal, both extremes produce the same post-swap average:
    // (6000 + 500*4) / 5 = 1600, comfortably inside 0-3500. The average check
    // alone would pass this roster, so the rejection can only come from the
    // per-player cap on the sub.
    expect(() =>
      validate(
        players(500, 500, 500, 500, 500),
        sub(6000),
        TournamentDivision.DIVISION_I,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a reserve that pushes a DIVISION_I team average over the max (up-move)', () => {
    // Replacing the lowest-rated starter (3000) with a sub at the cap (5500)
    // maximises the post-swap average, pushing it past maxAvg 3500.
    expect(() =>
      validate(
        players(3000, 3000, 3000, 3000, 5000),
        sub(5500),
        TournamentDivision.DIVISION_I,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a reserve that could drop a DIVISION_III team below the min (down-move)', () => {
    // Original roster: (7000+7000+7000+7000+8000)/5 = 7200 -> eligible for
    // DIVISION_III (avg >= 7000). Sub is 6500.
    // Replace-lowest (7000 -> 6500): (6500+7000+7000+7000+8000)/5 = 7100,
    // still >= 7000 -> that extreme alone stays eligible.
    // Replace-highest (8000 -> 6500): (7000+7000+7000+7000+6500)/5 = 6900,
    // < 7000 -> that extreme alone is ineligible.
    // Only the down-move (replace-highest) extreme fires; the replace-lowest
    // extreme would pass this roster on its own, so this isolates the
    // down-move branch.
    expect(() =>
      validate(
        players(7000, 7000, 7000, 7000, 8000),
        sub(6500),
        TournamentDivision.DIVISION_III,
      ),
    ).toThrow(BadRequestException);
  });

  it('allows a reserve over the DIVISION_I cap under DIVISION_II, the catch-all with no per-player cap', () => {
    // Same roster and sub as the cap test above, but under DIVISION_II
    // (maxPlayerRating: null). Original avg 500 is eligible for DIVISION_II
    // (0-7000, no cap). Since every starter is equal, both extremes give the
    // same post-swap average: (6000 + 500*4) / 5 = 1600, inside 0-7000. With
    // no per-player cap for this division, nothing rejects the sub even
    // though its rating (6000) exceeds the DIVISION_I cap of 5500 that
    // rejected the identical sub above.
    expect(() =>
      validate(
        players(500, 500, 500, 500, 500),
        sub(6000),
        TournamentDivision.DIVISION_II,
      ),
    ).not.toThrow();
  });
});
