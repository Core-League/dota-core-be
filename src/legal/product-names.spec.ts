import { Player } from '../players/player.entity';
import { TournamentDonationsService } from '../tournaments/tournament-donations.service';
import { TournamentPaymentsService } from '../tournaments/tournament-payments.service';
import { PaymentStatus } from '../tournaments/tournament-team-payment.model';
import { VipPayment } from '../vip/vip-payment.entity';
import { VipSubscription } from '../vip/vip-subscription.entity';
import { VipService } from '../vip/vip.service';
import {
  ENTRY_FEE_PRODUCT_NAME,
  LEGAL_VERSION,
  PAYMENT_PRODUCT_NAMES,
  SUPPORT_PRODUCT_NAME,
  VIP_PRODUCT_NAME,
} from './legal.constants';

/** Checkout consent every payment intent must carry. */
const CONSENT = { consent: true, legalVersion: LEGAL_VERSION };

/**
 * Words an acquirer reads as gambling, betting or "donations" (WayForPay
 * review, owner 2026-10-14). None may reach a payment page or card statement.
 */
const BANNED_WORDS = [
  'donate',
  'donation',
  'bet',
  'betting',
  'odds',
  'stake',
  'jackpot',
  'casino',
  'lottery',
  'win money',
  'донат',
  'ставка',
  'коефіцієнт',
  'джекпот',
  'казино',
  'лотерея',
  'виграш',
  'розіграш',
];

/** An admin-typed tournament name full of every banned word. */
const HOSTILE_NAME = `Casino Jackpot Bet Cup — донат, ставка, виграш, розіграш (${BANNED_WORDS.join(' ')})`;

function bannedIn(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_WORDS.filter((word) => lower.includes(word));
}

const headers = {
  host: 'api.example',
  'x-forwarded-proto': 'https',
  origin: 'https://spa.example',
};

const env = {
  CORS_ORIGINS: 'https://spa.example',
  MONOBANK_MERCHANT_TOKEN: 'merchant-token',
};

function wayforpayStub(configured: boolean) {
  return {
    isConfigured: () => configured,
    purchase: jest
      .fn()
      .mockResolvedValue({ url: 'https://secure.wayforpay.com/page' }),
    checkStatus: jest.fn(),
  };
}

function monobankStub() {
  return {
    createInvoice: jest
      .fn()
      .mockResolvedValue({ invoiceId: 'inv_1', pageUrl: 'https://pay/1' }),
    removeInvoice: jest.fn(),
  };
}

/** What the payer would see: every productName / destination sent out. */
function sentNames(
  wayforpay: { purchase: jest.Mock },
  monobank: { createInvoice: jest.Mock },
): string[] {
  return [
    ...wayforpay.purchase.mock.calls.map(
      ([p]) => (p as { productName: string }).productName,
    ),
    ...monobank.createInvoice.mock.calls.map(
      ([p]) => (p as { destination: string }).destination,
    ),
  ];
}

describe('payment product names', () => {
  it.each(PAYMENT_PRODUCT_NAMES.map((name) => [name]))(
    '"%s" carries no banned word',
    (name) => {
      expect(bannedIn(name)).toEqual([]);
    },
  );

  it('the banned-word check itself catches a hostile name', () => {
    expect(bannedIn(HOSTILE_NAME).length).toBe(BANNED_WORDS.length);
  });

  describe.each([
    ['WayForPay', true],
    ['Monobank', false],
  ])('sent to %s', (_provider, wfpConfigured) => {
    it('entry fee: fixed wording, whatever the tournament is called', async () => {
      const wayforpay = wayforpayStub(wfpConfigured);
      const monobank = monobankStub();
      const tournament = {
        id: 't1',
        name: HOSTILE_NAME,
        entryFee: 50000,
        tournamentStatus: 'REGISTRATION',
        registrationStartsAt: new Date(Date.now() - 3600_000),
        registrationEndsAt: new Date(Date.now() + 3600_000),
        registrationClosedAt: null,
      };
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
          .mockResolvedValue({ id: 'team1' }),
      };
      const service = new TournamentPaymentsService(
        {} as never,
        {
          getRepository: () => lookups,
          transaction: (run: (m: unknown) => unknown) =>
            run({ getRepository: () => managerRepo }),
        } as never,
        monobank as never,
        { getEnvConfig: () => env } as never,
        { assertTeamCanJoin: jest.fn() } as never,
        wayforpay as never,
      );

      await service.createIntentForCaptain('t1', 'p1', headers, CONSENT);

      const names = sentNames(wayforpay, monobank);
      expect(names).toEqual([ENTRY_FEE_PRODUCT_NAME]);
      expect(bannedIn(names[0])).toEqual([]);
    });

    it('support payment: fixed wording, whatever the tournament is called', async () => {
      const wayforpay = wayforpayStub(wfpConfigured);
      const monobank = monobankStub();
      const donationRepo = {
        generateUniqueReference: jest.fn().mockResolvedValue('DON-AAA111'),
        create: jest.fn((d: unknown) => d),
        save: jest.fn().mockImplementation((d: unknown) => Promise.resolve(d)),
        insert: jest.fn(),
      };
      const service = new TournamentDonationsService(
        donationRepo as never,
        {
          getRepository: () => ({
            findOne: jest
              .fn()
              .mockResolvedValue({ id: 't1', name: HOSTILE_NAME }),
          }),
          transaction: (run: (m: unknown) => unknown) =>
            run({ getRepository: () => donationRepo }),
        } as never,
        monobank as never,
        { getEnvConfig: () => env } as never,
        wayforpay as never,
      );

      await service.createIntent('t1', 10000, headers, CONSENT);

      const names = sentNames(wayforpay, monobank);
      expect(names).toEqual([SUPPORT_PRODUCT_NAME]);
      expect(bannedIn(names[0])).toEqual([]);
    });

    it('VIP: fixed wording', async () => {
      const wayforpay = wayforpayStub(wfpConfigured);
      const monobank = monobankStub();
      const payments = {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((d: unknown) => d),
        save: jest.fn().mockImplementation((d: unknown) => Promise.resolve(d)),
        insert: jest.fn(),
      };
      const repos = new Map<unknown, unknown>([
        [
          Player,
          {
            findOne: jest.fn().mockResolvedValue({ id: 'p1', vipUntil: null }),
          },
        ],
        [
          VipSubscription,
          {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn((d: unknown) => d),
            save: jest.fn(),
          },
        ],
        [VipPayment, payments],
      ]);
      const getRepository = (entity: unknown) =>
        repos.get(entity) ?? { insert: jest.fn() };
      const service = new VipService(
        {
          getRepository,
          transaction: (run: (m: unknown) => unknown) => run({ getRepository }),
        } as never,
        monobank as never,
        { getEnvConfig: () => env } as never,
        { changed: jest.fn() } as never,
        wayforpay as never,
      );

      await service.checkout('p1', headers, CONSENT);

      const names = sentNames(wayforpay, monobank);
      expect(names).toEqual([VIP_PRODUCT_NAME]);
      expect(bannedIn(names[0])).toEqual([]);
    });
  });
});
