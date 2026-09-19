import { PaymentStatus } from './tournament-team-payment.model';
import {
  nextPaymentState,
  type TInvoiceCallback,
  type TPaymentSnapshot,
} from './tournament-payment-transition';

describe('nextPaymentState', () => {
  const now = new Date('2026-09-19T12:00:00Z');

  const pending: TPaymentSnapshot = {
    status: PaymentStatus.PENDING,
    amountPaid: 0,
    paidAt: null,
    invoiceId: 'inv_1',
    paymentPageUrl: 'https://pay.mbnk.biz/inv_1',
  };

  const callback = (patch: Partial<TInvoiceCallback>): TInvoiceCallback => ({
    invoiceId: 'inv_1',
    status: 'created',
    ...patch,
  });

  it('settles a successful invoice', () => {
    const next = nextPaymentState(
      pending,
      callback({ status: 'success', amount: 50000, finalAmount: 50000 }),
      now,
    );
    expect(next).toEqual({
      status: PaymentStatus.PAID,
      amountPaid: 50000,
      paidAt: now,
      invoiceId: 'inv_1',
      paymentPageUrl: null,
    });
  });

  it('prefers finalAmount over amount', () => {
    const next = nextPaymentState(
      pending,
      callback({ status: 'success', amount: 50000, finalAmount: 49900 }),
      now,
    );
    expect(next?.amountPaid).toBe(49900);
  });

  it('uses the callback modifiedDate as paidAt when present', () => {
    const next = nextPaymentState(
      pending,
      callback({
        status: 'success',
        amount: 50000,
        modifiedDate: '2026-09-19T11:30:00Z',
      }),
      now,
    );
    expect(next?.paidAt).toEqual(new Date('2026-09-19T11:30:00Z'));
  });

  it.each(['failure', 'expired', 'reversed'] as const)(
    'clears the invoice and stays PENDING on %s',
    (status) => {
      const next = nextPaymentState(pending, callback({ status }), now);
      expect(next).toEqual({
        status: PaymentStatus.PENDING,
        amountPaid: 0,
        paidAt: null,
        invoiceId: null,
        paymentPageUrl: null,
      });
    },
  );

  it.each(['created', 'processing', 'hold'] as const)(
    'is a no-op for the in-flight status %s',
    (status) => {
      expect(nextPaymentState(pending, callback({ status }), now)).toBeNull();
    },
  );

  it('never downgrades a payment that is already PAID', () => {
    const paid: TPaymentSnapshot = {
      status: PaymentStatus.PAID,
      amountPaid: 50000,
      paidAt: new Date('2026-09-18T00:00:00Z'),
      invoiceId: 'inv_1',
      paymentPageUrl: null,
    };
    for (const status of [
      'failure',
      'expired',
      'reversed',
      'success',
    ] as const) {
      expect(nextPaymentState(paid, callback({ status }), now)).toBeNull();
    }
  });

  it('ignores an unknown status rather than guessing', () => {
    const rogue = {
      invoiceId: 'inv_1',
      status: 'teapot',
    } as unknown as TInvoiceCallback;
    expect(nextPaymentState(pending, rogue, now)).toBeNull();
  });
});
