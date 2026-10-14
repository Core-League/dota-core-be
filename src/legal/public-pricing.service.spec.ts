import { TournamentStatus } from '../tournaments/tournaments.model';
import { LEGAL_VERSION } from './legal.constants';
import { PublicPricingService } from './public-pricing.service';

const HOUR = 3600 * 1000;

/**
 * The public price list: fixed VIP and support numbers, and the paid
 * tournaments a payer can still buy into (registration open, or not started).
 */
describe('PublicPricingService', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const at = (hours: number) => new Date(now.getTime() + hours * HOUR);

  const tournament = (over: Record<string, unknown> = {}) => ({
    id: 't-open',
    name: 'Core Cup',
    entryFee: 50000,
    prizePool: 5000,
    tournamentStatus: TournamentStatus.REGISTRATION,
    registrationStartsAt: at(-48),
    registrationEndsAt: at(24),
    registrationClosedAt: null,
    hasQualification: true,
    qualificationStartsAt: at(48),
    tournamentStartsAt: at(96),
    ...over,
  });

  const build = (rows: Record<string, unknown>[]) => {
    const find = jest.fn().mockResolvedValue(rows);
    const service = new PublicPricingService({
      getRepository: () => ({ find }),
    } as never);
    return { service, find };
  };

  it('answers the contract shape with the checkout constants', async () => {
    const { service } = build([]);
    await expect(service.getPricing(now)).resolves.toEqual({
      currency: 'UAH',
      legalVersion: LEGAL_VERSION,
      vip: {
        priceKopecks: 20000,
        periodMonths: 1,
        switchDiscountPercent: 10,
        tournamentDiscountPercent: 10,
      },
      support: { minKopecks: 1000, maxKopecks: 5000000 },
      tournaments: [],
    });
  });

  it('prices an open tournament: fee, per player, VIP fee, dates', async () => {
    const { service } = build([tournament()]);
    const { tournaments } = await service.getPricing(now);
    expect(tournaments).toEqual([
      {
        id: 't-open',
        name: 'Core Cup',
        entryFeeKopecks: 50000,
        perPlayerKopecks: 10000,
        vipEntryFeeKopecks: 45000,
        prizePool: 5000,
        registrationEndsAt: at(24).toISOString(),
        startsAt: at(48).toISOString(),
      },
    ]);
  });

  it('reports an early admin close as the registration end, and the playoff start without qualification', async () => {
    const { service } = build([
      tournament({
        registrationClosedAt: at(-1),
        hasQualification: false,
        qualificationStartsAt: null,
      }),
    ]);
    const [row] = (await service.getPricing(now)).tournaments;
    expect(row.registrationEndsAt).toBe(at(-1).toISOString());
    expect(row.startsAt).toBe(at(96).toISOString());
  });

  it('lists a tournament still to start, and drops one already under way with registration closed', async () => {
    const { service } = build([
      tournament({ id: 'upcoming', registrationEndsAt: at(-1) }),
      tournament({
        id: 'running',
        tournamentStatus: TournamentStatus.QUALIFICATIONS,
        registrationEndsAt: at(-1),
        qualificationStartsAt: at(-2),
      }),
      tournament({
        id: 'late-registration',
        tournamentStatus: TournamentStatus.QUALIFICATIONS,
        qualificationStartsAt: at(-2),
      }),
    ]);
    const ids = (await service.getPricing(now)).tournaments.map((t) => t.id);
    expect(ids).toEqual(['upcoming', 'late-registration']);
  });

  it('asks the database for paid, unfinished tournaments only', async () => {
    const { service, find } = build([]);
    await service.getPricing(now);
    const [options] = find.mock.calls[0] as [
      { where: Record<string, { _type: string; _value: unknown }> },
    ];
    expect(options.where.entryFee).toMatchObject({
      _type: 'moreThan',
      _value: 0,
    });
    expect(options.where.tournamentStatus).toMatchObject({
      _type: 'not',
      _value: TournamentStatus.COMPLETED,
    });
  });
});
