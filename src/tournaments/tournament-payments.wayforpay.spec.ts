import { wfpOrderReference } from '../connectors/wayforpay/wayforpay.types';
import { PaymentStatus } from './tournament-team-payment.model';
import { TournamentDonationsService } from './tournament-donations.service';
import { TournamentPaymentsService } from './tournament-payments.service';
import { LEGAL_VERSION } from '../legal/legal.constants';

/** Checkout consent every payment intent must carry. */
const CONSENT = { consent: true, legalVersion: LEGAL_VERSION };

const headers = {
  host: 'api.example',
  'x-forwarded-proto': 'https',
  origin: 'https://spa.example',
};

function wayforpayStub() {
  return {
    isConfigured: jest.fn().mockReturnValue(true),
    purchase: jest
      .fn()
      .mockResolvedValue({ url: 'https://secure.wayforpay.com/page?vkh=new' }),
    checkStatus: jest.fn(),
  };
}

/**
 * The entry-fee flow once WayForPay takes payments: pages are minted per order
 * reference, reused while live, asked about once they lapse, and a Monobank
 * invoice from before the switch is withdrawn.
 */
describe('createIntentForCaptain with WayForPay', () => {
  const tournament = {
    id: 't1',
    name: 'Core Cup',
    entryFee: 50000,
    tournamentStatus: 'REGISTRATION',
    registrationStartsAt: new Date(Date.now() - 3600_000),
    registrationEndsAt: new Date(Date.now() + 3600_000),
    registrationClosedAt: null,
  };
  const team = { id: 'team1' };

  const build = (payment: Record<string, unknown>) => {
    const wayforpay = wayforpayStub();
    const acquiring = {
      createInvoice: jest.fn(),
      removeInvoice: jest.fn().mockResolvedValue(undefined),
    };
    const managerRepo = {
      findOne: jest.fn().mockResolvedValue(payment),
      create: jest.fn((data: unknown) => data),
      save: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
      insert: jest.fn(),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest
          .fn()
          .mockResolvedValueOnce(tournament)
          .mockResolvedValue(team),
      }),
      transaction: jest
        .fn()
        .mockImplementation((run: (m: unknown) => unknown) =>
          run({ getRepository: () => managerRepo }),
        ),
    };
    const qualification = {
      assertTeamCanJoin: jest.fn(),
      joinTournamentAsPaidTeam: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TournamentPaymentsService(
      {} as never,
      dataSource as never,
      acquiring as never,
      {
        getEnvConfig: () => ({ CORS_ORIGINS: 'https://spa.example' }),
      } as never,
      qualification as never,
      wayforpay as never,
    );
    return { service, wayforpay, acquiring, qualification };
  };

  const pending = (over: Record<string, unknown> = {}) => ({
    tournamentId: 't1',
    teamId: 'team1',
    reference: 'CORE-AAA111',
    status: PaymentStatus.PENDING,
    amountPaid: 0,
    paidAt: null,
    amountDue: 50000,
    invoiceId: null,
    paymentPageUrl: null,
    ...over,
  });

  it('mints a WayForPay page under a fresh order reference', async () => {
    const { service, wayforpay, acquiring } = build(pending());
    const intent = await service.createIntentForCaptain(
      't1',
      'p1',
      headers,
      CONSENT,
    );
    expect(acquiring.createInvoice).not.toHaveBeenCalled();
    const [params] = wayforpay.purchase.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(params.orderReference).toMatch(/^CORE-AAA111_[0-9A-Z]+$/);
    expect(params.amount).toBe(50000);
    expect(params.serviceUrl).toBe('https://api.example/webhook/wayforpay');
    expect(params.returnUrl).toBe('https://spa.example/tournaments/t1');
    expect(intent.pageUrl).toBe('https://secure.wayforpay.com/page?vkh=new');
  });

  it('reuses a live page at the same price without asking WayForPay', async () => {
    const live = wfpOrderReference(
      'CORE-AAA111',
      new Date(Date.now() + 30 * 60_000),
    );
    const { service, wayforpay } = build(
      pending({ invoiceId: live, paymentPageUrl: 'https://wfp/live' }),
    );
    const intent = await service.createIntentForCaptain(
      't1',
      'p1',
      headers,
      CONSENT,
    );
    expect(intent.pageUrl).toBe('https://wfp/live');
    expect(wayforpay.checkStatus).not.toHaveBeenCalled();
    expect(wayforpay.purchase).not.toHaveBeenCalled();
  });

  it('a lapsed page nobody paid is replaced', async () => {
    const lapsed = wfpOrderReference(
      'CORE-AAA111',
      new Date(Date.now() - 60_000),
    );
    const { service, wayforpay } = build(
      pending({ invoiceId: lapsed, paymentPageUrl: 'https://wfp/old' }),
    );
    wayforpay.checkStatus.mockResolvedValue({
      orderReference: lapsed,
      transactionStatus: 'Declined',
      reasonCode: 1127,
    });
    const intent = await service.createIntentForCaptain(
      't1',
      'p1',
      headers,
      CONSENT,
    );
    expect(wayforpay.purchase).toHaveBeenCalledTimes(1);
    expect(intent.pageUrl).toBe('https://secure.wayforpay.com/page?vkh=new');
  });

  it('a lapsed page that was paid settles the fee and registers the team instead of minting another', async () => {
    const lapsed = wfpOrderReference(
      'CORE-AAA111',
      new Date(Date.now() - 60_000),
    );
    const { service, wayforpay, qualification } = build(
      pending({ invoiceId: lapsed, paymentPageUrl: 'https://wfp/old' }),
    );
    wayforpay.checkStatus.mockResolvedValue({
      orderReference: lapsed,
      transactionStatus: 'Approved',
      amount: 500,
      currency: 'UAH',
    });
    const intent = await service.createIntentForCaptain(
      't1',
      'p1',
      headers,
      CONSENT,
    );
    expect(intent.status).toBe(PaymentStatus.PAID);
    expect(intent.amountPaid).toBe(50000);
    expect(wayforpay.purchase).not.toHaveBeenCalled();
    expect(qualification.joinTournamentAsPaidTeam).toHaveBeenCalledWith(
      't1',
      'team1',
    );
  });

  it('withdraws a Monobank invoice from before the switch and mints a WayForPay page', async () => {
    const { service, wayforpay, acquiring } = build(
      pending({
        invoiceId: 'p2_monoInv',
        paymentPageUrl: 'https://pay.mbnk.biz/x',
      }),
    );
    const intent = await service.createIntentForCaptain(
      't1',
      'p1',
      headers,
      CONSENT,
    );
    expect(acquiring.removeInvoice).toHaveBeenCalledWith('p2_monoInv');
    expect(wayforpay.purchase).toHaveBeenCalledTimes(1);
    expect(intent.pageUrl).toBe('https://secure.wayforpay.com/page?vkh=new');
  });
});

describe('TournamentDonationsService.createIntent with WayForPay', () => {
  it('mints a WayForPay page for every donation', async () => {
    const wayforpay = wayforpayStub();
    const acquiring = { createInvoice: jest.fn() };
    const donationRepo = {
      generateUniqueReference: jest.fn().mockResolvedValue('DON-REF001'),
      create: jest.fn((data: unknown) => data),
      save: jest
        .fn()
        .mockImplementation((d: Record<string, unknown>) =>
          Promise.resolve({ ...d }),
        ),
    };
    const service = new TournamentDonationsService(
      donationRepo as never,
      {
        getRepository: () => ({
          findOne: jest.fn().mockResolvedValue({ id: 't1', name: 'Core Cup' }),
        }),
        transaction: (run: (m: unknown) => unknown) =>
          run({
            getRepository: () => ({ ...donationRepo, insert: jest.fn() }),
          }),
      } as never,
      acquiring as never,
      {
        getEnvConfig: () => ({
          CORS_ORIGINS: 'https://spa.example',
          MONOBANK_MERCHANT_TOKEN: 'still-set',
        }),
      } as never,
      wayforpay as never,
    );
    const intent = await service.createIntent('t1', 10000, headers, CONSENT);
    expect(acquiring.createInvoice).not.toHaveBeenCalled();
    const [params] = wayforpay.purchase.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(params.orderReference).toMatch(/^DON-REF001_[0-9A-Z]+$/);
    expect(params.amount).toBe(10000);
    expect(intent.pageUrl).toBe('https://secure.wayforpay.com/page?vkh=new');
  });
});
