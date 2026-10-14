import { wfpToInvoiceCallback } from '../connectors/wayforpay/wayforpay-callback.mapper';
import { LEGAL_VERSION } from '../legal/legal.constants';
import { TournamentDonationsService } from './tournament-donations.service';
import { TournamentPaymentsService } from './tournament-payments.service';
import { PaymentStatus } from './tournament-team-payment.model';
import { TournamentStatus } from './tournaments.model';

const DAY = 24 * 3600 * 1000;
const ORDER = 'CORE-AAA111_T0ZZZZ';

/** A signed WayForPay callback for the paid entry-fee order, after a refund. */
const refundTx = (status: 'Refunded' | 'Voided' = 'Refunded') =>
  wfpToInvoiceCallback({
    orderReference: ORDER,
    transactionStatus: status,
    amount: 500,
    currency: 'UAH',
  });

/**
 * A refunded entry fee (WayForPay Refunded / Voided, Monobank reversed) marks
 * the payment REFUNDED once and withdraws the team while the tournament has
 * not started; once it has, the team stays and admins are warned.
 */
describe('TournamentPaymentsService: refunded entry fee', () => {
  const build = (
    tournamentOver: Record<string, unknown> = {},
    paymentOver: Record<string, unknown> = {},
  ) => {
    const payment = {
      id: 'pay1',
      tournamentId: 't1',
      teamId: 'team1',
      reference: 'CORE-AAA111',
      status: PaymentStatus.PAID,
      amountPaid: 50000,
      amountDue: 50000,
      paidAt: new Date(Date.now() - DAY),
      invoiceId: ORDER,
      paymentPageUrl: null,
      ...paymentOver,
    };
    const paymentRepo = {
      findByInvoiceId: jest.fn((id: string) =>
        Promise.resolve(id === payment.invoiceId ? payment : null),
      ),
      findByReferences: jest.fn().mockResolvedValue([payment]),
      save: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
      // The conditional PAID → REFUNDED update of the real repository.
      markRefunded: jest.fn(() => {
        if (payment.status !== PaymentStatus.PAID) {
          return Promise.resolve(false);
        }
        payment.status = PaymentStatus.REFUNDED;
        return Promise.resolve(true);
      }),
    };
    const tournament = {
      id: 't1',
      tournamentStatus: TournamentStatus.REGISTRATION,
      hasQualification: true,
      qualificationStartsAt: new Date(Date.now() + 3 * DAY),
      tournamentStartsAt: new Date(Date.now() + 5 * DAY),
      ...tournamentOver,
    };
    const qualification = {
      withdrawTeam: jest.fn().mockResolvedValue(true),
      joinTournamentAsPaidTeam: jest.fn(),
    };
    const service = new TournamentPaymentsService(
      paymentRepo as never,
      {
        getRepository: () => ({
          findOne: jest.fn().mockResolvedValue(tournament),
        }),
      } as never,
      {} as never,
      {} as never,
      qualification as never,
    );
    return { service, payment, paymentRepo, qualification };
  };

  it.each(['Refunded', 'Voided'] as const)(
    'WayForPay %s before the start: REFUNDED and the team is withdrawn',
    async (status) => {
      const { service, payment, qualification } = build();
      await expect(
        service.applyInvoiceCallback(refundTx(status)),
      ).resolves.toBe(true);
      expect(payment.status).toBe(PaymentStatus.REFUNDED);
      expect(qualification.withdrawTeam).toHaveBeenCalledWith('t1', 'team1');
    },
  );

  it('a repeated refund callback revokes nothing twice', async () => {
    const { service, qualification, paymentRepo } = build();
    await service.applyInvoiceCallback(refundTx());
    await service.applyInvoiceCallback(refundTx());
    await service.applyInvoiceCallback(refundTx('Voided'));
    expect(paymentRepo.markRefunded).toHaveBeenCalledTimes(1);
    expect(qualification.withdrawTeam).toHaveBeenCalledTimes(1);
  });

  it('a parallel copy that loses the conditional update withdraws nothing', async () => {
    const { service, qualification, paymentRepo } = build();
    paymentRepo.markRefunded.mockResolvedValueOnce(false);
    await service.applyInvoiceCallback(refundTx());
    expect(qualification.withdrawTeam).not.toHaveBeenCalled();
  });

  it('once the tournament is under way the team stays registered', async () => {
    const { service, payment, qualification } = build({
      tournamentStatus: TournamentStatus.QUALIFICATIONS,
      qualificationStartsAt: new Date(Date.now() - DAY),
    });
    await service.applyInvoiceCallback(refundTx());
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(qualification.withdrawTeam).not.toHaveBeenCalled();
  });

  it('play already begun counts as started even before the status moves', async () => {
    const { service, qualification } = build({
      hasQualification: false,
      qualificationStartsAt: null,
      tournamentStartsAt: new Date(Date.now() - 60_000),
    });
    await service.applyInvoiceCallback(refundTx());
    expect(qualification.withdrawTeam).not.toHaveBeenCalled();
  });

  it('a failed withdrawal is logged, never thrown (the callback is still accepted)', async () => {
    const { service, qualification } = build();
    qualification.withdrawTeam.mockRejectedValue(new Error('Dota API down'));
    await expect(service.applyInvoiceCallback(refundTx())).resolves.toBe(true);
  });

  it('a refund of some other invoice of the paid row changes nothing', async () => {
    const { service, payment, qualification } = build(
      {},
      { invoiceId: 'CORE-AAA111_NEWER' },
    );
    await service.applyInvoiceCallback(refundTx());
    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(qualification.withdrawTeam).not.toHaveBeenCalled();
  });

  it('paying again after a refund starts the row over with a fresh page', async () => {
    const refunded = {
      tournamentId: 't1',
      teamId: 'team1',
      reference: 'CORE-AAA111',
      status: PaymentStatus.REFUNDED,
      amountPaid: 50000,
      amountDue: 50000,
      paidAt: new Date(Date.now() - DAY),
      invoiceId: ORDER,
      paymentPageUrl: null,
    };
    const wayforpay = {
      isConfigured: () => true,
      purchase: jest.fn().mockResolvedValue({ url: 'https://wfp/new' }),
      checkStatus: jest.fn(),
    };
    const lookups = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({
          id: 't1',
          entryFee: 50000,
          tournamentStatus: TournamentStatus.REGISTRATION,
          registrationStartsAt: new Date(Date.now() - DAY),
          registrationEndsAt: new Date(Date.now() + DAY),
          registrationClosedAt: null,
        })
        .mockResolvedValue({ id: 'team1' }),
    };
    const managerRepo = {
      findOne: jest.fn().mockResolvedValue(refunded),
      save: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
      insert: jest.fn(),
    };
    const service = new TournamentPaymentsService(
      {} as never,
      {
        getRepository: () => lookups,
        transaction: (run: (m: unknown) => unknown) =>
          run({ getRepository: () => managerRepo }),
      } as never,
      {} as never,
      {
        getEnvConfig: () => ({ CORS_ORIGINS: 'https://spa.example' }),
      } as never,
      { assertTeamCanJoin: jest.fn() } as never,
      wayforpay as never,
    );
    const intent = await service.createIntentForCaptain(
      't1',
      'p1',
      { host: 'api.example', origin: 'https://spa.example' },
      { consent: true, legalVersion: LEGAL_VERSION },
    );
    expect(intent).toMatchObject({
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      pageUrl: 'https://wfp/new',
    });
    expect(wayforpay.purchase).toHaveBeenCalledTimes(1);
  });
});

describe('TournamentDonationsService: refunded support payment', () => {
  it('is marked REFUNDED once', async () => {
    const donation = {
      reference: 'DON-AAA111',
      status: PaymentStatus.PAID,
      amount: 10000,
      amountPaid: 10000,
      paidAt: new Date(Date.now() - DAY),
      invoiceId: 'DON-AAA111_T0ZZZZ',
      paymentPageUrl: null,
    };
    const donationRepo = {
      findByInvoiceId: jest.fn().mockResolvedValue(donation),
      findByReference: jest.fn().mockResolvedValue(donation),
      save: jest.fn().mockImplementation((d: unknown) => Promise.resolve(d)),
    };
    const service = new TournamentDonationsService(
      donationRepo as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const tx = wfpToInvoiceCallback({
      orderReference: 'DON-AAA111_T0ZZZZ',
      transactionStatus: 'Refunded',
      amount: 100,
      currency: 'UAH',
    });

    await service.applyInvoiceCallback(tx);
    await service.applyInvoiceCallback(tx);

    expect(donationRepo.save).toHaveBeenCalledTimes(1);
    expect(donation).toMatchObject({
      status: PaymentStatus.REFUNDED,
      amountPaid: 10000,
    });
  });
});
