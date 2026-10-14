import { Player } from '../players/player.entity';
import { TournamentPaymentsService } from '../tournaments/tournament-payments.service';
import { PaymentStatus } from '../tournaments/tournament-team-payment.model';
import { TournamentStatus } from '../tournaments/tournaments.model';
import { VipPayment } from '../vip/vip-payment.entity';
import { VipSubscription } from '../vip/vip-subscription.entity';
import { VipService } from '../vip/vip.service';
import { LEGAL_VERSION } from './legal.constants';
import { PublicPricingService } from './public-pricing.service';

const CONSENT = { consent: true, legalVersion: LEGAL_VERSION };
const DAY = 24 * 3600 * 1000;

const headers = {
  host: 'api.example',
  'x-forwarded-proto': 'https',
  origin: 'https://spa.example',
};
const env = { CORS_ORIGINS: 'https://spa.example' };

const tournament = {
  id: 't1',
  name: 'Core Cup',
  entryFee: 52300,
  prizePool: 5000,
  tournamentStatus: TournamentStatus.REGISTRATION,
  registrationStartsAt: new Date(Date.now() - DAY),
  registrationEndsAt: new Date(Date.now() + DAY),
  registrationClosedAt: null,
  hasQualification: false,
  qualificationStartsAt: null,
  tournamentStartsAt: new Date(Date.now() + 3 * DAY),
};

function wayforpayStub() {
  return {
    isConfigured: () => true,
    purchase: jest.fn().mockResolvedValue({ url: 'https://wfp/page' }),
    checkStatus: jest.fn(),
  };
}

async function publicPricing() {
  return new PublicPricingService({
    getRepository: () => ({ find: jest.fn().mockResolvedValue([tournament]) }),
  } as never).getPricing();
}

/** What WayForPay is asked to charge for the entry fee of this captain. */
async function chargedEntryFee(captainVipUntil: Date | null): Promise<number> {
  const wayforpay = wayforpayStub();
  const managerRepo = {
    findOne: jest.fn().mockResolvedValue({
      tournamentId: 't1',
      teamId: 'team1',
      reference: 'CORE-AAA111',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      amountDue: null,
      invoiceId: null,
      paymentPageUrl: null,
    }),
    save: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
    insert: jest.fn(),
  };
  const lookups = {
    findOne: jest
      .fn()
      .mockResolvedValueOnce(tournament)
      .mockResolvedValue({
        id: 'team1',
        captain: { id: 'p1', vipUntil: captainVipUntil },
      }),
  };
  const service = new TournamentPaymentsService(
    {} as never,
    {
      getRepository: () => lookups,
      transaction: (run: (m: unknown) => unknown) =>
        run({ getRepository: () => managerRepo }),
    } as never,
    {} as never,
    { getEnvConfig: () => env } as never,
    { assertTeamCanJoin: jest.fn() } as never,
    wayforpay as never,
  );
  const intent = await service.createIntentForCaptain(
    't1',
    'p1',
    headers,
    CONSENT,
  );
  const [params] = wayforpay.purchase.mock.calls[0] as [{ amount: number }];
  expect(intent.amount).toBe(params.amount);
  return params.amount;
}

/** What WayForPay is asked to charge for the first VIP month. */
async function chargedVip(discountPercent: number | null): Promise<number> {
  const wayforpay = wayforpayStub();
  const getRepository = (entity: unknown) =>
    new Map<unknown, unknown>([
      [
        Player,
        { findOne: jest.fn().mockResolvedValue({ id: 'p1', vipUntil: null }) },
      ],
      [
        VipSubscription,
        {
          findOne: jest
            .fn()
            .mockResolvedValue(
              discountPercent === null
                ? null
                : { discountPercent, autoRenew: false },
            ),
        },
      ],
      [
        VipPayment,
        {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn((d: unknown) => d),
          save: jest
            .fn()
            .mockImplementation((d: unknown) => Promise.resolve(d)),
          insert: jest.fn(),
        },
      ],
    ]).get(entity) ?? { insert: jest.fn() };
  const service = new VipService(
    {
      getRepository,
      transaction: (run: (m: unknown) => unknown) => run({ getRepository }),
    } as never,
    {} as never,
    { getEnvConfig: () => env } as never,
    { changed: jest.fn() } as never,
    wayforpay as never,
  );
  const checkout = await service.checkout('p1', headers, CONSENT);
  const [params] = wayforpay.purchase.mock.calls[0] as [{ amount: number }];
  expect(checkout.amount).toBe(params.amount);
  return params.amount;
}

/**
 * The public price list and the amount actually sent to the payment provider
 * come from the same helpers; these pin that they agree.
 */
describe('GET /public/pricing equals the checkout', () => {
  it('VIP at full price', async () => {
    const pricing = await publicPricing();
    await expect(chargedVip(null)).resolves.toBe(pricing.vip.priceKopecks);
    await expect(chargedVip(0)).resolves.toBe(pricing.vip.priceKopecks);
  });

  it('VIP with the loyalty (switch) discount', async () => {
    const pricing = await publicPricing();
    const charged = await chargedVip(pricing.vip.switchDiscountPercent);
    expect(charged).toBe(
      Math.round(
        (pricing.vip.priceKopecks * (100 - pricing.vip.switchDiscountPercent)) /
          100,
      ),
    );
    expect(charged).toBe(18000);
  });

  it('entry fee without VIP', async () => {
    const [listed] = (await publicPricing()).tournaments;
    await expect(chargedEntryFee(null)).resolves.toBe(listed.entryFeeKopecks);
    await expect(chargedEntryFee(new Date(Date.now() - DAY))).resolves.toBe(
      listed.entryFeeKopecks,
    );
  });

  it('entry fee with the VIP discount', async () => {
    const pricing = await publicPricing();
    const [listed] = pricing.tournaments;
    await expect(
      chargedEntryFee(new Date(Date.now() + 10 * DAY)),
    ).resolves.toBe(listed.vipEntryFeeKopecks);
    expect(listed.vipEntryFeeKopecks).toBe(
      Math.round(
        (listed.entryFeeKopecks *
          (100 - pricing.vip.tournamentDiscountPercent)) /
          100,
      ),
    );
  });

  it('per player is the fee over a 5-player roster', async () => {
    const [listed] = (await publicPricing()).tournaments;
    expect(listed.perPlayerKopecks).toBe(Math.round(52300 / 5));
  });
});
