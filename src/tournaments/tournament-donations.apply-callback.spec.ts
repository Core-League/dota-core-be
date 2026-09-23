import { PaymentStatus } from './tournament-team-payment.model';
import { TournamentDonationsService } from './tournament-donations.service';
import type { TInvoiceCallbackPayload } from '../connectors/monobank-acquiring/monobank-acquiring.types';

/**
 * Exercises `applyInvoiceCallback` for donations against the real
 * `nextPaymentState` — the same status matrix the entry-fee flow uses — with
 * only the repository stubbed.
 */
describe('TournamentDonationsService.applyInvoiceCallback', () => {
  const build = (donation: Record<string, unknown> | null) => {
    const donationRepo = {
      findByInvoiceId: jest.fn().mockResolvedValue(donation),
      findByReference: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((d: unknown) => Promise.resolve(d)),
    };
    const service = new TournamentDonationsService(
      donationRepo as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, donationRepo };
  };

  const pending = () => ({
    reference: 'DON-AAA111',
    status: PaymentStatus.PENDING,
    amount: 10000,
    amountPaid: 0,
    paidAt: null,
    invoiceId: 'inv_1',
    paymentPageUrl: 'https://pay.mbnk.biz/inv_1',
  });

  const callback = (
    patch: Partial<TInvoiceCallbackPayload>,
  ): TInvoiceCallbackPayload =>
    ({
      invoiceId: 'inv_1',
      status: 'success',
      ...patch,
    }) as TInvoiceCallbackPayload;

  const savedRow = (donationRepo: { save: jest.Mock }) =>
    (donationRepo.save.mock.calls[0] as [Record<string, unknown>])[0];

  it('success → PAID with amountPaid from finalAmount, invoice page cleared', async () => {
    const { service, donationRepo } = build(pending());

    const attributed = await service.applyInvoiceCallback(
      callback({
        amount: 10000,
        finalAmount: 10000,
        modifiedDate: '2026-09-23T10:00:00Z',
      }),
    );

    expect(attributed).toBe(true);
    expect(donationRepo.findByInvoiceId).toHaveBeenCalledWith('inv_1');
    expect(donationRepo.save).toHaveBeenCalledTimes(1);
    expect(savedRow(donationRepo)).toMatchObject({
      status: PaymentStatus.PAID,
      amountPaid: 10000,
      paidAt: new Date('2026-09-23T10:00:00Z'),
      invoiceId: 'inv_1',
      paymentPageUrl: null,
    });
  });

  it.each(['failure', 'expired', 'reversed'] as const)(
    '%s → clears the invoice and stays PENDING',
    async (status) => {
      const { service, donationRepo } = build(pending());

      const attributed = await service.applyInvoiceCallback(
        callback({ status }),
      );

      expect(attributed).toBe(true);
      expect(donationRepo.save).toHaveBeenCalledTimes(1);
      expect(savedRow(donationRepo)).toMatchObject({
        status: PaymentStatus.PENDING,
        amountPaid: 0,
        paidAt: null,
        invoiceId: null,
        paymentPageUrl: null,
      });
    },
  );

  it('a callback after PAID is a no-op (terminal), but still attributed', async () => {
    const { service, donationRepo } = build({
      ...pending(),
      status: PaymentStatus.PAID,
      amountPaid: 10000,
      paidAt: new Date('2026-09-01T00:00:00Z'),
      paymentPageUrl: null,
    });

    for (const status of ['success', 'failure', 'reversed'] as const) {
      await expect(
        service.applyInvoiceCallback(callback({ status })),
      ).resolves.toBe(true);
    }

    expect(donationRepo.save).not.toHaveBeenCalled();
  });

  it('falls back to the DON- reference when no row carries the invoiceId', async () => {
    const { service, donationRepo } = build(null);
    donationRepo.findByReference.mockResolvedValue({
      ...pending(),
      invoiceId: null,
      paymentPageUrl: null,
    });

    const attributed = await service.applyInvoiceCallback(
      callback({
        invoiceId: 'inv_retry',
        reference: 'DON-AAA111',
        amount: 10000,
      }),
    );

    expect(attributed).toBe(true);
    expect(donationRepo.findByReference).toHaveBeenCalledWith('DON-AAA111');
    expect(savedRow(donationRepo)).toMatchObject({
      status: PaymentStatus.PAID,
      amountPaid: 10000,
      invoiceId: 'inv_retry',
    });
  });

  it('reports false and saves nothing when no donation matches', async () => {
    const { service, donationRepo } = build(null);

    await expect(
      service.applyInvoiceCallback(
        callback({ invoiceId: 'inv_unknown', reference: 'DON-NOPE' }),
      ),
    ).resolves.toBe(false);

    expect(donationRepo.save).not.toHaveBeenCalled();
  });
});
