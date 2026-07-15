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

  it('rejects a reserve that exceeds the per-player cap, regardless of average', () => {
    // Cap is a flat check on the sub, independent of who it replaces.
    expect(() =>
      validate(
        players(3000, 3000, 3000, 3000, 3000),
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
    // The roster is eligible for DIVISION_III (avg 7004), but replacing the
    // highest-rated starter with a weak sub drops the average under 7000 —
    // ineligible for the tournament's division even though the roster's own
    // resolved division would still be fine.
    expect(() =>
      validate(
        players(7000, 7000, 7000, 7010, 7010),
        sub(1000),
        TournamentDivision.DIVISION_III,
      ),
    ).toThrow(BadRequestException);
  });
});
