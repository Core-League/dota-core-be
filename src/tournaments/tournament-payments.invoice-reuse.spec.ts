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

  const build = (payment: Record<string, unknown>) => {
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
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest
          .fn()
          .mockResolvedValueOnce(tournament)
          .mockResolvedValue(team),
      }),
    };
    const config = {
      getEnvConfig: () => ({ CORS_ORIGINS: 'https://spa.example' }),
    };
    const service = new TournamentPaymentsService(
      paymentRepo as never,
      dataSource as never,
      acquiring as never,
      config as never,
    );
    return { service, acquiring, paymentRepo };
  };

  it('reuses a live invoice instead of creating another', async () => {
    const { service, acquiring } = build({
      reference: 'CORE-AAA111',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      invoiceId: 'inv_live',
      paymentPageUrl: 'https://pay.mbnk.biz/inv_live',
    });

    const intent = await service.createIntentForCaptain('t1', 'p1', headers);

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
    ).rejects.toThrow();

    expect(acquiring.createInvoice).not.toHaveBeenCalled();
  });
});
