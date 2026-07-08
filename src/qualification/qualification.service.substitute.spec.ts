import { BadRequestException } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import type { Player } from '../players/player.entity';

/**
 * Focused unit tests for the substitution rule: a reserve is valid only if it
 * keeps the team in the SAME division no matter which main player it replaces.
 * Division is average-only (≤6500 → I, >6500 → II), so the check must guard both
 * the up-move (replace weakest → highest avg) and the down-move (replace
 * strongest → lowest avg).
 */
describe('QualificationService.validateSubstitute (two-sided division guard)', () => {
  type SubstituteSurface = {
    validateSubstitute(mainPlayers: Player[], sub: Player): void;
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

  const validate = (main: Player[], reserve: Player) =>
    service.validateSubstitute(main, reserve);

  it('allows a weak reserve on a DIVISION_I team', () => {
    expect(() =>
      validate(players(5000, 5500, 6000, 6500, 7000), sub(4000)),
    ).not.toThrow();
  });

  it('rejects a reserve that pushes a DIVISION_I team up to DIVISION_II', () => {
    expect(() =>
      validate(players(6400, 6400, 6400, 6400, 6400), sub(9000)),
    ).toThrow(BadRequestException);
  });

  it('allows a comparable reserve that keeps a DIVISION_II team in II', () => {
    expect(() =>
      validate(players(7000, 7000, 7000, 7000, 7000), sub(6800)),
    ).not.toThrow();
  });

  it('rejects a reserve that could drop a DIVISION_II team to DIVISION_I (down-move)', () => {
    // Replacing the lowest keeps avg > 6500 (II), but replacing the top 7000
    // player drops avg to 6488 (I) — the two-sided check must catch this.
    expect(() =>
      validate(players(6510, 6510, 6510, 6510, 7000), sub(6400)),
    ).toThrow(BadRequestException);
  });
});
