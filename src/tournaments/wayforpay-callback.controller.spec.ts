import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WayForPayCallbackController } from './wayforpay-callback.controller';

describe('WayForPayCallbackController', () => {
  const tx = {
    merchantAccount: 'test_merch',
    orderReference: 'CORE-ABC234_T0K3N',
    amount: 450,
    currency: 'UAH',
    transactionStatus: 'Approved',
    reasonCode: 1100,
    merchantSignature: 'sig',
  };
  const request = (body: string) => ({ rawBody: Buffer.from(body) }) as never;

  const build = (verified = true, configured = true) => {
    const wayforpay = {
      isConfigured: jest.fn().mockReturnValue(configured),
      verify: jest.fn().mockReturnValue(verified),
      acceptReply: jest.fn((orderReference: string) => ({
        orderReference,
        status: 'accept',
        time: 1,
        signature: 'reply',
      })),
    };
    const payments = {
      applyInvoiceCallback: jest.fn().mockResolvedValue(false),
    };
    const donations = {
      applyInvoiceCallback: jest.fn().mockResolvedValue(false),
    };
    const vip = { applyWayForPayCallback: jest.fn().mockResolvedValue(false) };
    const controller = new WayForPayCallbackController(
      wayforpay as never,
      payments as never,
      donations as never,
      vip as never,
    );
    return { controller, wayforpay, payments, donations, vip };
  };

  it('settles an entry fee through the shared state machine and answers with the signed accept', async () => {
    const { controller, payments, donations, vip } = build();
    payments.applyInvoiceCallback.mockResolvedValue(true);
    const reply = await controller.receive(request(JSON.stringify(tx)));
    expect(reply).toMatchObject({
      orderReference: tx.orderReference,
      status: 'accept',
    });
    expect(payments.applyInvoiceCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 'CORE-ABC234_T0K3N',
        reference: 'CORE-ABC234',
        status: 'success',
        amount: 45000,
      }),
    );
    expect(donations.applyInvoiceCallback).not.toHaveBeenCalled();
    expect(vip.applyWayForPayCallback).not.toHaveBeenCalled();
  });

  it('reads the JSON when WayForPay posts it as the key of a form body', async () => {
    const { controller, donations } = build();
    donations.applyInvoiceCallback.mockResolvedValue(true);
    await controller.receive(
      request(`${encodeURIComponent(JSON.stringify(tx))}=`),
    );
    expect(donations.applyInvoiceCallback).toHaveBeenCalled();
  });

  it('falls through to VIP, and still accepts an order nobody owns', async () => {
    const { controller, vip } = build();
    const reply = await controller.receive(request(JSON.stringify(tx)));
    expect(vip.applyWayForPayCallback).toHaveBeenCalledWith(
      expect.objectContaining({ orderReference: tx.orderReference }),
    );
    expect(reply.status).toBe('accept');
  });

  it('rejects a forged callback before touching any payment', async () => {
    const { controller, payments } = build(false);
    await expect(
      controller.receive(request(JSON.stringify(tx))),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(payments.applyInvoiceCallback).not.toHaveBeenCalled();
  });

  it('rejects an unreadable body, and answers 503 while WayForPay is not configured', async () => {
    await expect(
      build().controller.receive(request('garbage')),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      build(true, false).controller.receive(request(JSON.stringify(tx))),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
