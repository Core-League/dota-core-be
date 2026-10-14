import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { wfpOrderReference } from '../connectors/wayforpay/wayforpay.types';
import { Player } from '../players/player.entity';
import { CreateTournamentDonationDto } from '../tournaments/dto/create-tournament-donation.dto';
import { TournamentDonationsService } from '../tournaments/tournament-donations.service';
import { TournamentPaymentsService } from '../tournaments/tournament-payments.service';
import { PaymentStatus } from '../tournaments/tournament-team-payment.model';
import { VipPayment } from '../vip/vip-payment.entity';
import { VipSubscription } from '../vip/vip-subscription.entity';
import { VipService } from '../vip/vip.service';
import { PaymentConsentDto } from './dto/payment-consent.dto';
import { LEGAL_VERSION } from './legal.constants';
import {
  CONSENT_REQUIRED_MESSAGE,
  LEGAL_VERSION_OUTDATED_MESSAGE,
  assertPaymentConsent,
} from './payment-consent';
import {
  PaymentConsent,
  PaymentConsentProduct,
} from './payment-consent.entity';

const CONSENT = { consent: true, legalVersion: LEGAL_VERSION };

const headers = {
  host: 'api.example',
  'x-forwarded-proto': 'https',
  origin: 'https://spa.example',
};

const env = { CORS_ORIGINS: 'https://spa.example' };

/** Every way a checkout can arrive without valid consent, and the 400 it gets. */
const REFUSALS: [string, Record<string, unknown> | undefined, string][] = [
  ['no body at all', undefined, CONSENT_REQUIRED_MESSAGE],
  [
    'no consent flag',
    { legalVersion: LEGAL_VERSION },
    CONSENT_REQUIRED_MESSAGE,
  ],
  [
    'consent: false',
    { consent: false, legalVersion: LEGAL_VERSION },
    CONSENT_REQUIRED_MESSAGE,
  ],
  [
    'consent: "true" (a string)',
    { consent: 'true', legalVersion: LEGAL_VERSION },
    CONSENT_REQUIRED_MESSAGE,
  ],
  [
    'a stale legalVersion',
    { consent: true, legalVersion: '2026-01-01' },
    LEGAL_VERSION_OUTDATED_MESSAGE,
  ],
  ['no legalVersion', { consent: true }, LEGAL_VERSION_OUTDATED_MESSAGE],
];

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { message: string })
      .message;
  }
  throw new Error('expected a 400');
}

function wayforpayStub() {
  return {
    isConfigured: () => true,
    purchase: jest
      .fn()
      .mockResolvedValue({ url: 'https://secure.wayforpay.com/page' }),
    checkStatus: jest.fn(),
  };
}

/** Entry fee: a pending row under the lock, optionally holding a live page. */
function buildEntryFee(payment: Record<string, unknown>) {
  const wayforpay = wayforpayStub();
  const consentRepo = { insert: jest.fn() };
  const paymentRepo = {
    findOne: jest.fn().mockResolvedValue(payment),
    save: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
  };
  const lookup = jest
    .fn()
    .mockResolvedValueOnce({
      id: 't1',
      name: 'Core Cup',
      entryFee: 50000,
      tournamentStatus: 'REGISTRATION',
      registrationStartsAt: new Date(Date.now() - 3600_000),
      registrationEndsAt: new Date(Date.now() + 3600_000),
      registrationClosedAt: null,
    })
    .mockResolvedValue({ id: 'team1' });
  const dataSource = {
    getRepository: jest.fn().mockReturnValue({ findOne: lookup }),
    transaction: jest.fn().mockImplementation((run: (m: unknown) => unknown) =>
      run({
        getRepository: (entity: unknown) =>
          entity === PaymentConsent ? consentRepo : paymentRepo,
      }),
    ),
  };
  const service = new TournamentPaymentsService(
    {} as never,
    dataSource as never,
    {} as never,
    { getEnvConfig: () => env } as never,
    { assertTeamCanJoin: jest.fn() } as never,
    wayforpay as never,
  );
  return { service, wayforpay, consentRepo, dataSource };
}

function buildSupport() {
  const wayforpay = wayforpayStub();
  const consentRepo = { insert: jest.fn() };
  let seq = 0;
  const donationRepo = {
    generateUniqueReference: jest
      .fn()
      .mockImplementation(() => Promise.resolve(`DON-REF00${(seq += 1)}`)),
    create: jest.fn((d: unknown) => d),
    save: jest.fn().mockImplementation((d: unknown) => Promise.resolve(d)),
  };
  const dataSource = {
    getRepository: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue({ id: 't1', name: 'Core Cup' }),
    }),
    transaction: jest.fn().mockImplementation((run: (m: unknown) => unknown) =>
      run({
        getRepository: (entity: unknown) =>
          entity === PaymentConsent ? consentRepo : donationRepo,
      }),
    ),
  };
  const service = new TournamentDonationsService(
    donationRepo as never,
    dataSource as never,
    {} as never,
    { getEnvConfig: () => env } as never,
    wayforpay as never,
  );
  return { service, wayforpay, consentRepo, donationRepo, dataSource };
}

function buildVip() {
  const wayforpay = wayforpayStub();
  const consentRepo = { insert: jest.fn() };
  const payments = {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((d: unknown) => d),
    save: jest.fn().mockImplementation((d: unknown) => Promise.resolve(d)),
  };
  const repos = new Map<unknown, unknown>([
    [
      Player,
      { findOne: jest.fn().mockResolvedValue({ id: 'p1', vipUntil: null }) },
    ],
    [VipSubscription, { findOne: jest.fn().mockResolvedValue(null) }],
    [VipPayment, payments],
    [PaymentConsent, consentRepo],
  ]);
  const getRepository = jest.fn((entity: unknown) => repos.get(entity));
  const dataSource = {
    getRepository,
    transaction: jest
      .fn()
      .mockImplementation((run: (m: unknown) => unknown) =>
        run({ getRepository }),
      ),
  };
  const service = new VipService(
    dataSource as never,
    {} as never,
    { getEnvConfig: () => env } as never,
    { changed: jest.fn() } as never,
    wayforpay as never,
  );
  return { service, wayforpay, consentRepo, payments, dataSource };
}

describe('assertPaymentConsent', () => {
  it.each(REFUSALS)('refuses %s', async (_case, input, message) => {
    await expect(
      refusal(() => Promise.resolve(assertPaymentConsent(input))),
    ).resolves.toBe(message);
  });

  it('accepts consent: true with the current version', () => {
    expect(() => assertPaymentConsent(CONSENT)).not.toThrow();
  });

  it('pins the exact Ukrainian messages of the checkout', () => {
    expect(CONSENT_REQUIRED_MESSAGE).toBe(
      'Потрібна згода з Договором публічної оферти та Політикою повернення коштів',
    );
    expect(LEGAL_VERSION_OUTDATED_MESSAGE).toBe(
      'Умови оновлено — оновіть сторінку й погодьтеся з актуальною версією',
    );
  });
});

describe('PaymentConsentDto through the v1 ValidationPipe rules', () => {
  const strict = { whitelist: true, forbidNonWhitelisted: true };

  it('lets consent fields through the whitelist on every intent body', async () => {
    await expect(
      validate(plainToInstance(PaymentConsentDto, CONSENT), strict),
    ).resolves.toEqual([]);
    await expect(
      validate(
        plainToInstance(CreateTournamentDonationDto, {
          amount: 10000,
          ...CONSENT,
        }),
        strict,
      ),
    ).resolves.toEqual([]);
  });

  it('leaves a missing or wrong value to the service, which answers with the Ukrainian message', async () => {
    await expect(
      validate(plainToInstance(PaymentConsentDto, {}), strict),
    ).resolves.toEqual([]);
    await expect(
      validate(
        plainToInstance(PaymentConsentDto, { consent: 'yes', legalVersion: 1 }),
        strict,
      ),
    ).resolves.toEqual([]);
  });
});

describe('consent on the three payment intents', () => {
  describe.each(REFUSALS)('%s', (_case, input, message) => {
    it('POST /tournaments/:id/payments/intent is refused before anything is read or minted', async () => {
      const { service, wayforpay, consentRepo, dataSource } = buildEntryFee({
        reference: 'CORE-AAA111',
        status: PaymentStatus.PENDING,
      });
      await expect(
        refusal(() =>
          service.createIntentForCaptain('t1', 'p1', headers, input as never),
        ),
      ).resolves.toBe(message);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(wayforpay.purchase).not.toHaveBeenCalled();
      expect(consentRepo.insert).not.toHaveBeenCalled();
    });

    it('POST /tournaments/:id/donations/intent is refused before any row is inserted', async () => {
      const { service, wayforpay, donationRepo, dataSource } = buildSupport();
      await expect(
        refusal(() =>
          service.createIntent('t1', 10000, headers, input as never),
        ),
      ).resolves.toBe(message);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(donationRepo.save).not.toHaveBeenCalled();
      expect(wayforpay.purchase).not.toHaveBeenCalled();
    });

    it('POST /vip/checkout is refused before any row is inserted', async () => {
      const { service, wayforpay, payments, dataSource } = buildVip();
      await expect(
        refusal(() => service.checkout('p1', headers, input as never)),
      ).resolves.toBe(message);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(payments.save).not.toHaveBeenCalled();
      expect(wayforpay.purchase).not.toHaveBeenCalled();
    });
  });
});

describe('payment_consent log', () => {
  const insertedRows = (consentRepo: { insert: jest.Mock }) =>
    consentRepo.insert.mock.calls.map(
      ([row]) => row as Record<string, unknown>,
    );

  it('entry fee: one row for a newly minted page, inside the payment transaction', async () => {
    const { service, consentRepo, dataSource } = buildEntryFee({
      tournamentId: 't1',
      teamId: 'team1',
      reference: 'CORE-AAA111',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      amountDue: null,
      invoiceId: null,
      paymentPageUrl: null,
    });
    await service.createIntentForCaptain('t1', 'p1', headers, CONSENT);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(insertedRows(consentRepo)).toEqual([
      {
        playerId: 'p1',
        legalVersion: LEGAL_VERSION,
        product: PaymentConsentProduct.ENTRY_FEE,
        reference: 'CORE-AAA111',
        amountKopecks: 50000,
        currency: 'UAH',
        provider: 'wayforpay',
      },
    ]);
  });

  it('entry fee: a live page handed out again is not logged again', async () => {
    const live = wfpOrderReference(
      'CORE-AAA111',
      new Date(Date.now() + 30 * 60_000),
    );
    const { service, wayforpay, consentRepo } = buildEntryFee({
      tournamentId: 't1',
      teamId: 'team1',
      reference: 'CORE-AAA111',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      amountDue: 50000,
      invoiceId: live,
      paymentPageUrl: 'https://wfp/live',
    });
    const intent = await service.createIntentForCaptain(
      't1',
      'p1',
      headers,
      CONSENT,
    );
    expect(intent.pageUrl).toBe('https://wfp/live');
    expect(wayforpay.purchase).not.toHaveBeenCalled();
    expect(consentRepo.insert).not.toHaveBeenCalled();
  });

  it('support: one row per payment, guest payer recorded as null', async () => {
    const { service, consentRepo, dataSource } = buildSupport();
    await service.createIntent('t1', 30000, headers, CONSENT);
    await service.createIntent('t1', 10000, headers, CONSENT, 'p7');
    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(insertedRows(consentRepo)).toEqual([
      {
        playerId: null,
        legalVersion: LEGAL_VERSION,
        product: PaymentConsentProduct.SUPPORT,
        reference: 'DON-REF001',
        amountKopecks: 30000,
        currency: 'UAH',
        provider: 'wayforpay',
      },
      expect.objectContaining({
        playerId: 'p7',
        reference: 'DON-REF002',
        amountKopecks: 10000,
      }),
    ]);
  });

  it('VIP: one row for the checkout page', async () => {
    const { service, consentRepo, dataSource } = buildVip();
    const checkout = await service.checkout('p1', headers, CONSENT);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(insertedRows(consentRepo)).toEqual([
      {
        playerId: 'p1',
        legalVersion: LEGAL_VERSION,
        product: PaymentConsentProduct.VIP,
        reference: checkout.reference,
        amountKopecks: 20000,
        currency: 'UAH',
        provider: 'wayforpay',
      },
    ]);
  });

  it('VIP: no row when WayForPay refuses to mint the page', async () => {
    const { service, wayforpay, consentRepo } = buildVip();
    wayforpay.purchase.mockRejectedValue(new Error('HTTP 500'));
    await expect(service.checkout('p1', headers, CONSENT)).rejects.toThrow();
    expect(consentRepo.insert).not.toHaveBeenCalled();
  });
});
