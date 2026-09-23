import { ForbiddenException, Logger } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { TournamentPaymentCallbackController } from './tournament-payment-callback.controller';

/**
 * Produces raw bytes for a JSON payload that differ, byte-for-byte, from
 * what `Buffer.from(JSON.stringify(body))` would produce — reversed key
 * order plus extra whitespace. Every test below asserts `verifyCallback` was
 * called with exactly these bytes, so a regression to re-serialising
 * `req.body` (the hazard the whole raw-body plumbing exists to avoid) would
 * fail the assertion instead of passing it by coincidence.
 */
function rawBytesFor(body: Record<string, unknown>): Buffer {
  const entries = Object.entries(body)
    .reverse()
    .map(([key, value]) => `  "${key}":   ${JSON.stringify(value)}`)
    .join(',\n');
  return Buffer.from(`{\n${entries}\n}`);
}

describe('TournamentPaymentCallbackController', () => {
  const validBody = {
    invoiceId: 'inv_1',
    status: 'success',
    amount: 50000,
    finalAmount: 50000,
    reference: 'CORE-AAA111',
    modifiedDate: '2026-09-19T11:30:00Z',
  };
  const validRawBody = rawBytesFor(validBody);

  const build = () => {
    const acquiring = { verifyCallback: jest.fn() };
    // Each service reports whether it attributed the callback to one of its
    // rows; the controller falls through on `false`.
    const payments = {
      applyInvoiceCallback: jest.fn().mockResolvedValue(true),
    };
    const donations = {
      applyInvoiceCallback: jest.fn().mockResolvedValue(false),
    };
    const controller = new TournamentPaymentCallbackController(
      acquiring as never,
      payments as never,
      donations as never,
    );
    return { controller, acquiring, payments, donations };
  };

  const reqWith = (
    rawBody: Buffer | undefined,
    body: unknown,
  ): RawBodyRequest<Request> =>
    ({ rawBody, body }) as unknown as RawBodyRequest<Request>;

  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('applies the callback and acks 200 on a valid signature and payload', async () => {
    const { controller, acquiring, payments } = build();
    acquiring.verifyCallback.mockResolvedValue(true);

    const result = await controller.receive(
      reqWith(validRawBody, validBody),
      'good-signature',
    );

    expect(result).toEqual({ status: 'ok' });
    expect(acquiring.verifyCallback).toHaveBeenCalledWith(
      validRawBody,
      'good-signature',
    );
    expect(payments.applyInvoiceCallback).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv_1', status: 'success' }),
    );
  });

  it('rejects an invalid or missing signature with 403 and applies no state change', async () => {
    const { controller, acquiring, payments, donations } = build();
    acquiring.verifyCallback.mockResolvedValue(false);

    await expect(
      controller.receive(reqWith(validRawBody, validBody), undefined),
    ).rejects.toThrow(ForbiddenException);

    expect(acquiring.verifyCallback).toHaveBeenCalledWith(validRawBody, '');
    expect(payments.applyInvoiceCallback).not.toHaveBeenCalled();
    expect(donations.applyInvoiceCallback).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the raw body was not captured, without calling the verifier', async () => {
    const { controller, acquiring, payments, donations } = build();

    await expect(
      controller.receive(reqWith(undefined, validBody), 'some-signature'),
    ).rejects.toThrow(ForbiddenException);

    expect(acquiring.verifyCallback).not.toHaveBeenCalled();
    expect(payments.applyInvoiceCallback).not.toHaveBeenCalled();
    expect(donations.applyInvoiceCallback).not.toHaveBeenCalled();
  });

  it('logs and acks 200 without applying anything when the signed payload fails schema validation', async () => {
    const { controller, acquiring, payments, donations } = build();
    acquiring.verifyCallback.mockResolvedValue(true);

    const malformed = { status: 'success' }; // missing invoiceId
    const result = await controller.receive(
      reqWith(rawBytesFor(malformed), malformed),
      'good-signature',
    );

    expect(result).toEqual({ status: 'ignored' });
    expect(payments.applyInvoiceCallback).not.toHaveBeenCalled();
    expect(donations.applyInvoiceCallback).not.toHaveBeenCalled();
  });

  describe('dispatch', () => {
    it('an entry-fee invoice reaches TournamentPaymentsService and never the donations service', async () => {
      const { controller, acquiring, payments, donations } = build();
      acquiring.verifyCallback.mockResolvedValue(true);
      payments.applyInvoiceCallback.mockResolvedValue(true);

      const result = await controller.receive(
        reqWith(validRawBody, validBody),
        'good-signature',
      );

      expect(result).toEqual({ status: 'ok' });
      expect(payments.applyInvoiceCallback).toHaveBeenCalledTimes(1);
      expect(donations.applyInvoiceCallback).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('a donation invoice falls through to the donations service', async () => {
      const { controller, acquiring, payments, donations } = build();
      acquiring.verifyCallback.mockResolvedValue(true);
      payments.applyInvoiceCallback.mockResolvedValue(false);
      donations.applyInvoiceCallback.mockResolvedValue(true);

      const donationBody = {
        ...validBody,
        invoiceId: 'inv_don',
        reference: 'DON-BBB222',
        amount: 10000,
        finalAmount: 10000,
      };
      const result = await controller.receive(
        reqWith(rawBytesFor(donationBody), donationBody),
        'good-signature',
      );

      expect(result).toEqual({ status: 'ok' });
      expect(payments.applyInvoiceCallback).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceId: 'inv_don' }),
      );
      expect(donations.applyInvoiceCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: 'inv_don',
          reference: 'DON-BBB222',
        }),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('an invoice matching neither logs the unattributable error and still acks 200', async () => {
      const { controller, acquiring, payments, donations } = build();
      acquiring.verifyCallback.mockResolvedValue(true);
      payments.applyInvoiceCallback.mockResolvedValue(false);
      donations.applyInvoiceCallback.mockResolvedValue(false);

      const unmatched = { ...validBody, invoiceId: 'inv_unknown' };
      const result = await controller.receive(
        reqWith(rawBytesFor(unmatched), unmatched),
        'good-signature',
      );

      expect(result).toEqual({ status: 'ok' });
      expect(payments.applyInvoiceCallback).toHaveBeenCalledTimes(1);
      expect(donations.applyInvoiceCallback).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message] = errorSpy.mock.calls[0] as [unknown];
      expect(String(message)).toContain('inv_unknown');
    });
  });
});
