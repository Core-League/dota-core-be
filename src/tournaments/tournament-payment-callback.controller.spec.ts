import { ForbiddenException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { TournamentPaymentCallbackController } from './tournament-payment-callback.controller';

describe('TournamentPaymentCallbackController', () => {
  const validBody = {
    invoiceId: 'inv_1',
    status: 'success',
    amount: 50000,
    finalAmount: 50000,
    reference: 'CORE-AAA111',
    modifiedDate: '2026-09-19T11:30:00Z',
  };

  const build = () => {
    const acquiring = { verifyCallback: jest.fn() };
    const payments = {
      applyInvoiceCallback: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new TournamentPaymentCallbackController(
      acquiring as never,
      payments as never,
    );
    return { controller, acquiring, payments };
  };

  const reqWith = (
    rawBody: Buffer | undefined,
    body: unknown,
  ): RawBodyRequest<Request> =>
    ({ rawBody, body }) as unknown as RawBodyRequest<Request>;

  it('applies the callback and acks 200 on a valid signature and payload', async () => {
    const { controller, acquiring, payments } = build();
    acquiring.verifyCallback.mockResolvedValue(true);

    const result = await controller.receive(
      reqWith(Buffer.from(JSON.stringify(validBody)), validBody),
      'good-signature',
    );

    expect(result).toEqual({ status: 'ok' });
    expect(acquiring.verifyCallback).toHaveBeenCalledWith(
      Buffer.from(JSON.stringify(validBody)),
      'good-signature',
    );
    expect(payments.applyInvoiceCallback).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv_1', status: 'success' }),
    );
  });

  it('rejects an invalid or missing signature with 403 and applies no state change', async () => {
    const { controller, acquiring, payments } = build();
    acquiring.verifyCallback.mockResolvedValue(false);

    await expect(
      controller.receive(
        reqWith(Buffer.from(JSON.stringify(validBody)), validBody),
        undefined,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(acquiring.verifyCallback).toHaveBeenCalledWith(
      Buffer.from(JSON.stringify(validBody)),
      '',
    );
    expect(payments.applyInvoiceCallback).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the raw body was not captured, without calling the verifier', async () => {
    const { controller, acquiring, payments } = build();

    await expect(
      controller.receive(reqWith(undefined, validBody), 'some-signature'),
    ).rejects.toThrow(ForbiddenException);

    expect(acquiring.verifyCallback).not.toHaveBeenCalled();
    expect(payments.applyInvoiceCallback).not.toHaveBeenCalled();
  });

  it('acks 200 for a signed payload matching no known payment (schema-valid, service no-ops)', async () => {
    const { controller, acquiring, payments } = build();
    acquiring.verifyCallback.mockResolvedValue(true);
    payments.applyInvoiceCallback.mockResolvedValue(undefined);

    const unmatched = { ...validBody, invoiceId: 'inv_unknown' };
    const result = await controller.receive(
      reqWith(Buffer.from(JSON.stringify(unmatched)), unmatched),
      'good-signature',
    );

    expect(result).toEqual({ status: 'ok' });
    expect(payments.applyInvoiceCallback).toHaveBeenCalledTimes(1);
  });

  it('logs and acks 200 without applying anything when the signed payload fails schema validation', async () => {
    const { controller, acquiring, payments } = build();
    acquiring.verifyCallback.mockResolvedValue(true);

    const malformed = { status: 'success' }; // missing invoiceId
    const result = await controller.receive(
      reqWith(Buffer.from(JSON.stringify(malformed)), malformed),
      'good-signature',
    );

    expect(result).toEqual({ status: 'ignored' });
    expect(payments.applyInvoiceCallback).not.toHaveBeenCalled();
  });
});
