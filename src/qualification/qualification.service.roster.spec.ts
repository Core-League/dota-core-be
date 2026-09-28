import { BadRequestException } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import type { Player } from '../players/player.entity';

/**
 * Roster rules that survive the division removal. Tournaments are open entry:
 * no team-average bound and no per-player MMR cap. The only roster rules left
 * are verification, a non-empty main roster, and the reserve count.
 */
describe('QualificationService.validateRoster', () => {
  type RosterSurface = {
    validateRoster(main: Player[], reserved: Player[]): void;
  };

  const service = new QualificationService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  ) as unknown as RosterSurface;

  const player = (rating: number, verified = true): Player =>
    ({
      id: `p${rating}`,
      rating,
      verifiedAt: verified ? new Date() : null,
    }) as unknown as Player;

  const roster = (...ratings: number[]) => ratings.map((r) => player(r));

  it('accepts a roster that the old DIVISION_I cap would have rejected', () => {
    // avg 9000, every player far over the retired 5500 cap. Open entry.
    expect(() =>
      service.validateRoster(roster(9000, 9000, 9000, 9000, 9000), []),
    ).not.toThrow();
  });

  it('accepts a wildly mismatched roster — no average bound applies', () => {
    expect(() =>
      service.validateRoster(roster(100, 100, 100, 100, 12000), []),
    ).not.toThrow();
  });

  it('accepts any reserve regardless of rating', () => {
    expect(() =>
      service.validateRoster(roster(1000, 1000, 1000, 1000, 1000), [
        player(12000),
      ]),
    ).not.toThrow();
  });

  it('still rejects an empty main roster', () => {
    expect(() => service.validateRoster([], [])).toThrow(BadRequestException);
  });

  it('still rejects an unverified main player', () => {
    const main = [...roster(1000, 2000, 3000, 4000), player(5000, false)];
    expect(() => service.validateRoster(main, [])).toThrow(BadRequestException);
  });

  it('still rejects an unverified reserve', () => {
    expect(() =>
      service.validateRoster(roster(1000, 1000, 1000, 1000, 1000), [
        player(2000, false),
      ]),
    ).toThrow(BadRequestException);
  });

  it('still rejects more than three reserves', () => {
    expect(() =>
      service.validateRoster(roster(1000, 1000, 1000, 1000, 1000), [
        player(1000),
        player(2000),
        player(3000),
        player(4000),
      ]),
    ).toThrow(BadRequestException);
  });
});
