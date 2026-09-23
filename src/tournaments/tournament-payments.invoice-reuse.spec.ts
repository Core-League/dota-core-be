import { InternalServerErrorException } from '@nestjs/common';
import { PaymentStatus } from './tournament-team-payment.model';
import { TournamentPaymentsService } from './tournament-payments.service';

/**
 * Exercises only the invoice branch: the guards above it are covered by the
 * tournament schedule/registration utilities and need a real DataSource.
 */
describe('createIntentForCaptain invoice reuse', () => {
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
  const headers = { host: 'api.example', origin: 'https://spa.example' };

  const build = (
    payment: Record<string, unknown>,
    envOverrides: Record<string, unknown> = {
      CORS_ORIGINS: 'https://spa.example',
    },
  ) => {
    const acquiring = {
      createInvoice: jest.fn().mockResolvedValue({
        invoiceId: 'inv_new',
        pageUrl: 'https://pay.mbnk.biz/inv_new',
      }),
    };
    const paymentRepo = {
      findByTournamentAndTeam: jest.fn().mockResolvedValue(payment),
      save: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
      create: jest.fn(),
      generateUniqueReference: jest.fn(),
    };

    // The service runs the find-or-create + invoice decision inside
    // `dataSource.transaction`, taking a pessimistic write lock on the
    // payment row via `manager.getRepository(...).findOne(...)`. Simulate
    // that manager here so tests can assert the lock is actually requested,
    // and that a row already carrying an invoiceId under that lock is reused
    // rather than triggering another `createInvoice` call — which is what a
    // second concurrent request sees once it unblocks after the first's
    // transaction commits.
    const managerRepo = {
      findOne: jest.fn().mockResolvedValue(payment),
      create: jest.fn((data: unknown) => data),
      save: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(managerRepo),
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
        .mockImplementation((run: (m: unknown) => unknown) => run(manager)),
    };
    const config = {
      getEnvConfig: () => envOverrides,
    };
    // Eligibility is asserted before any invoice work; it is the qualification
    // service's concern and is covered by its own specs.
    const qualification = { assertTeamCanJoin: jest.fn() };
    const service = new TournamentPaymentsService(
      paymentRepo as never,
      dataSource as never,
      acquiring as never,
      config as never,
      qualification as never,
    );
    return { service, acquiring, paymentRepo, dataSource, managerRepo };
  };

  it('locks the payment row inside a transaction, then reuses a live invoice instead of creating another', async () => {
    const { service, acquiring, dataSource, managerRepo } = build({
      reference: 'CORE-AAA111',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      invoiceId: 'inv_live',
      paymentPageUrl: 'https://pay.mbnk.biz/inv_live',
    });

    const intent = await service.createIntentForCaptain('t1', 'p1', headers);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(managerRepo.findOne).toHaveBeenCalledWith({
      where: { tournamentId: 't1', teamId: 'team1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(acquiring.createInvoice).not.toHaveBeenCalled();
    expect(intent.pageUrl).toBe('https://pay.mbnk.biz/inv_live');
  });

  it('creates a new invoice after a previous one was cleared', async () => {
    const { service, acquiring } = build({
      reference: 'CORE-AAA111',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      invoiceId: null,
      paymentPageUrl: null,
    });

    const intent = await service.createIntentForCaptain('t1', 'p1', headers);

    expect(acquiring.createInvoice).toHaveBeenCalledTimes(1);
    expect(intent.pageUrl).toBe('https://pay.mbnk.biz/inv_new');
    // `jest.fn()`'s untyped generics make `.mock.calls[0]` resolve to `any`;
    // cast to the shape we know `createInvoice()` is called with so the
    // assertions below don't trip `no-unsafe-*` lint rules.
    const [params] = acquiring.createInvoice.mock.calls[0] as [
      { redirectUrl: string; webHookUrl: string },
    ];
    expect(params.redirectUrl).toBe('https://spa.example/tournaments/t1');
    expect(params.webHookUrl).toBe(
      'http://api.example/webhook/monobank/acquiring',
    );
  });

  it('creates no invoice for an already paid team', async () => {
    const { service, acquiring } = build({
      reference: 'CORE-AAA111',
      status: PaymentStatus.PAID,
      amountPaid: 50000,
      invoiceId: null,
      paymentPageUrl: null,
    });

    await service.createIntentForCaptain('t1', 'p1', headers);

    expect(acquiring.createInvoice).not.toHaveBeenCalled();
  });

  it('refuses to create an invoice when the derived API origin has no host', async () => {
    const { service, acquiring } = build({
      reference: 'CORE-AAA111',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      invoiceId: null,
      paymentPageUrl: null,
    });

    // No `host` and no `x-forwarded-host` header: apiOriginFrom would
    // otherwise return a bare "http://", which would ship a hostless
    // webHookUrl on a real invoice.
    await expect(
      service.createIntentForCaptain('t1', 'p1', {
        origin: 'https://spa.example',
      }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(acquiring.createInvoice).not.toHaveBeenCalled();
  });

  it('refuses to create an invoice when CORS_ORIGINS yields no usable SPA origin', async () => {
    const { service, acquiring } = build(
      {
        reference: 'CORE-AAA111',
        status: PaymentStatus.PENDING,
        amountPaid: 0,
        invoiceId: null,
        paymentPageUrl: null,
      },
      { CORS_ORIGINS: '' },
    );

    // A host is present (so the api-origin guard passes), but CORS_ORIGINS
    // has no usable entries: spaOriginFrom returns null, and redirecting the
    // captain to the api origin instead would 404 right after they paid.
    await expect(
      service.createIntentForCaptain('t1', 'p1', { host: 'api.example' }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(acquiring.createInvoice).not.toHaveBeenCalled();
  });
});
