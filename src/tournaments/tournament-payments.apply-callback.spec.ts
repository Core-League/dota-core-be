import { PaymentStatus } from './tournament-team-payment.model';
import { TournamentPaymentsService } from './tournament-payments.service';
import type { TInvoiceCallbackPayload } from '../connectors/monobank-acquiring/monobank-acquiring.types';

/**
 * Exercises `applyInvoiceCallback` against the real `nextPaymentState` — only
 * the repository is stubbed. Signature verification is the controller's job
 * (see `tournament-payment-callback.controller.spec.ts`); this file covers
 * what happens once a callback is already trusted.
 */
describe('TournamentPaymentsService.applyInvoiceCallback', () => {
  const build = (payment: Record<string, unknown> | null) => {
    const paymentRepo = {
      findByInvoiceId: jest.fn().mockResolvedValue(payment),
      findByReferences: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
    };
    const service = new TournamentPaymentsService(
      paymentRepo as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, paymentRepo };
  };

  const callback = (
    patch: Partial<TInvoiceCallbackPayload>,
  ): TInvoiceCallbackPayload =>
    ({
      invoiceId: 'inv_1',
      status: 'success',
      ...patch,
    }) as TInvoiceCallbackPayload;

  it('settles a pending payment matched by invoiceId', async () => {
    const payment = {
      reference: 'CORE-AAA111',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      paidAt: null,
      invoiceId: 'inv_1',
      paymentPageUrl: 'https://pay.mbnk.biz/inv_1',
    };
    const { service, paymentRepo } = build(payment);

    await service.applyInvoiceCallback(
      callback({ amount: 50000, finalAmount: 50000 }),
    );

    expect(paymentRepo.findByInvoiceId).toHaveBeenCalledWith('inv_1');
    expect(paymentRepo.save).toHaveBeenCalledTimes(1);
    const [saved] = paymentRepo.save.mock.calls[0] as [Record<string, unknown>];
    expect(saved).toMatchObject({
      status: PaymentStatus.PAID,
      amountPaid: 50000,
      invoiceId: 'inv_1',
      paymentPageUrl: null,
    });
  });

  it('falls back to reference when no row carries the invoiceId', async () => {
    const payment = {
      reference: 'CORE-BBB222',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      paidAt: null,
      invoiceId: null,
      paymentPageUrl: null,
    };
    const { service, paymentRepo } = build(null);
    paymentRepo.findByReferences.mockResolvedValue([payment]);

    await service.applyInvoiceCallback(
      callback({
        invoiceId: 'inv_retry',
        reference: 'CORE-BBB222',
        amount: 50000,
      }),
    );

    expect(paymentRepo.findByReferences).toHaveBeenCalledWith(['CORE-BBB222']);
    expect(paymentRepo.save).toHaveBeenCalledTimes(1);
    const [saved] = paymentRepo.save.mock.calls[0] as [Record<string, unknown>];
    expect(saved).toMatchObject({ status: PaymentStatus.PAID });
  });

  it('acks (no-op, no throw) a signed payload matching no known payment', async () => {
    const { service, paymentRepo } = build(null);

    await expect(
      service.applyInvoiceCallback(
        callback({ invoiceId: 'inv_unknown', reference: 'CORE-NOPE' }),
      ),
    ).resolves.toBeUndefined();

    expect(paymentRepo.save).not.toHaveBeenCalled();
  });

  it('does not wipe a live invoice B when a stale dead callback for old invoice A arrives via reference fallback', async () => {
    // The row has already moved on to invoice B (no `invoiceId: 'inv_A'`
    // column to find it by any more), so the callback for the dead old
    // invoice A only reaches this row through the reference fallback.
    const payment = {
      reference: 'CORE-DDD444',
      status: PaymentStatus.PENDING,
      amountPaid: 0,
      paidAt: null,
      invoiceId: 'inv_B',
      paymentPageUrl: 'https://pay.mbnk.biz/inv_B',
    };
    const { service, paymentRepo } = build(null);
    paymentRepo.findByReferences.mockResolvedValue([payment]);

    await service.applyInvoiceCallback(
      callback({
        invoiceId: 'inv_A',
        status: 'failure',
        reference: 'CORE-DDD444',
      }),
    );

    expect(paymentRepo.save).not.toHaveBeenCalled();
  });

  it('does not move a payment that is already PAID (terminal)', async () => {
    const payment = {
      reference: 'CORE-CCC333',
      status: PaymentStatus.PAID,
      amountPaid: 50000,
      paidAt: new Date('2026-09-01T00:00:00Z'),
      invoiceId: 'inv_1',
      paymentPageUrl: null,
    };
    const { service, paymentRepo } = build(payment);

    await service.applyInvoiceCallback(callback({ status: 'success' }));

    expect(paymentRepo.save).not.toHaveBeenCalled();
  });
});
