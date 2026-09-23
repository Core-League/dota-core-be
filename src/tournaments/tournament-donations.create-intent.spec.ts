import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus } from './tournament-team-payment.model';
import {
  DONATION_INVOICE_VALIDITY_SEC,
  TournamentDonationsService,
} from './tournament-donations.service';

type TInvoiceParams = {
  amount: number;
  reference: string;
  destination: string;
  redirectUrl: string;
  webHookUrl: string;
  validitySec: number;
};

/**
 * Exercises `createIntent` with the repository, acquiring client and config
 * stubbed. Unlike the entry-fee flow there is no find-or-create and no lock:
 * every call must produce a fresh row and a fresh invoice.
 */
describe('TournamentDonationsService.createIntent', () => {
  const tournament = {
    id: 't1',
    name: 'Core Cup',
    tournamentStatus: 'COMPLETED',
  };
  const headers = {
    host: 'api.example',
    'x-forwarded-proto': 'https',
    origin: 'https://spa.example',
  };

  const build = (
    options: {
      tournament?: Record<string, unknown> | null;
      env?: Record<string, unknown>;
    } = {},
  ) => {
    let referenceSeq = 0;
    const donationRepo = {
      generateUniqueReference: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(`DON-REF${(referenceSeq += 1)}`),
        ),
      create: jest.fn((data: unknown) => data),
      // Resolve a copy so each `save` call's recorded argument is a snapshot
      // of the row at that moment, not a reference mutated by later steps.
      save: jest
        .fn()
        .mockImplementation((d: Record<string, unknown>) =>
          Promise.resolve({ ...d }),
        ),
      findByInvoiceId: jest.fn(),
      findByReference: jest.fn(),
    };
    let invoiceSeq = 0;
    const acquiring = {
      createInvoice: jest.fn().mockImplementation(() => {
        invoiceSeq += 1;
        return Promise.resolve({
          invoiceId: `inv_${invoiceSeq}`,
          pageUrl: `https://pay.mbnk.biz/inv_${invoiceSeq}`,
        });
      }),
    };
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest
          .fn()
          .mockResolvedValue(
            options.tournament === undefined ? tournament : options.tournament,
          ),
      }),
    };
    const config = {
      getEnvConfig: () =>
        options.env ?? {
          CORS_ORIGINS: 'https://spa.example',
          MONOBANK_MERCHANT_TOKEN: 'merchant-token',
        },
    };
    const service = new TournamentDonationsService(
      donationRepo as never,
      dataSource as never,
      acquiring as never,
      config as never,
    );
    return { service, donationRepo, acquiring };
  };

  const savedRows = (donationRepo: { save: jest.Mock }) =>
    donationRepo.save.mock.calls.map(([row]) => row as Record<string, unknown>);

  it('404s when the tournament does not exist and inserts nothing', async () => {
    const { service, donationRepo, acquiring } = build({ tournament: null });

    await expect(
      service.createIntent('missing', 10000, headers),
    ).rejects.toThrow(NotFoundException);

    expect(donationRepo.save).not.toHaveBeenCalled();
    expect(acquiring.createInvoice).not.toHaveBeenCalled();
  });

  it('inserts a PENDING DON- row, creates the invoice with kopecks and derived URLs, then persists invoiceId/pageUrl', async () => {
    const { service, donationRepo, acquiring } = build();

    const intent = await service.createIntent('t1', 10000, headers);

    // First save: the bare PENDING row, before Monobank is called.
    const [inserted, withInvoice] = savedRows(donationRepo);
    expect(inserted).toMatchObject({
      tournamentId: 't1',
      reference: 'DON-REF1',
      amount: 10000,
      amountPaid: 0,
      status: PaymentStatus.PENDING,
      invoiceId: null,
      paymentPageUrl: null,
      donorPlayerId: null,
    });
    expect(inserted.reference).toMatch(/^DON-/);

    expect(acquiring.createInvoice).toHaveBeenCalledTimes(1);
    const [params] = acquiring.createInvoice.mock.calls[0] as [TInvoiceParams];
    expect(params).toEqual({
      amount: 10000,
      reference: 'DON-REF1',
      destination: 'Донат Core League — Core Cup',
      redirectUrl: 'https://spa.example/tournaments/t1',
      webHookUrl: 'https://api.example/webhook/monobank/acquiring',
      validitySec: DONATION_INVOICE_VALIDITY_SEC,
    });
    expect(DONATION_INVOICE_VALIDITY_SEC).toBe(24 * 3600);

    // Second save: the same row now carrying the invoice.
    expect(withInvoice).toMatchObject({
      reference: 'DON-REF1',
      invoiceId: 'inv_1',
      paymentPageUrl: 'https://pay.mbnk.biz/inv_1',
    });

    expect(intent).toEqual({
      reference: 'DON-REF1',
      amount: 10000,
      pageUrl: 'https://pay.mbnk.biz/inv_1',
    });
  });

  it('mints a second row and a second invoice on a second call (no reuse)', async () => {
    const { service, donationRepo, acquiring } = build();

    const first = await service.createIntent('t1', 10000, headers);
    const second = await service.createIntent('t1', 10000, headers);

    expect(donationRepo.generateUniqueReference).toHaveBeenCalledTimes(2);
    expect(acquiring.createInvoice).toHaveBeenCalledTimes(2);
    expect(first.reference).not.toBe(second.reference);
    expect(first.pageUrl).toBe('https://pay.mbnk.biz/inv_1');
    expect(second.pageUrl).toBe('https://pay.mbnk.biz/inv_2');
    // Two inserts + two invoice updates, never a lookup of an existing row.
    expect(donationRepo.save).toHaveBeenCalledTimes(4);
    expect(donationRepo.findByReference).not.toHaveBeenCalled();
  });

  it('attributes the donation to the caller when a player id is supplied', async () => {
    const { service, donationRepo } = build();

    await service.createIntent('t1', 30000, headers, 'player-42');

    const [inserted] = savedRows(donationRepo);
    expect(inserted.donorPlayerId).toBe('player-42');
  });

  it('allows donating to a COMPLETED tournament', async () => {
    const { service, acquiring } = build({
      tournament: { ...tournament, tournamentStatus: 'COMPLETED' },
    });

    await expect(
      service.createIntent('t1', 50000, headers),
    ).resolves.toMatchObject({ amount: 50000 });
    expect(acquiring.createInvoice).toHaveBeenCalledTimes(1);
  });

  it('returns pageUrl null and creates no invoice when MONOBANK_MERCHANT_TOKEN is missing', async () => {
    const { service, donationRepo, acquiring } = build({
      env: { CORS_ORIGINS: 'https://spa.example', MONOBANK_MERCHANT_TOKEN: '' },
    });

    const intent = await service.createIntent('t1', 10000, headers);

    expect(acquiring.createInvoice).not.toHaveBeenCalled();
    expect(donationRepo.save).toHaveBeenCalledTimes(1);
    expect(intent).toEqual({
      reference: 'DON-REF1',
      amount: 10000,
      pageUrl: null,
    });
  });

  it('refuses to create an invoice when the derived API origin has no host', async () => {
    const { service, acquiring } = build();

    // No `host` and no `x-forwarded-host`: a bare "http://" webHookUrl would
    // leave Monobank's callback nowhere to land.
    await expect(
      service.createIntent('t1', 10000, { origin: 'https://spa.example' }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(acquiring.createInvoice).not.toHaveBeenCalled();
  });

  it('refuses to create an invoice when CORS_ORIGINS yields no usable SPA origin', async () => {
    const { service, acquiring } = build({
      env: { CORS_ORIGINS: '', MONOBANK_MERCHANT_TOKEN: 'merchant-token' },
    });

    await expect(
      service.createIntent('t1', 10000, { host: 'api.example' }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(acquiring.createInvoice).not.toHaveBeenCalled();
  });
});
