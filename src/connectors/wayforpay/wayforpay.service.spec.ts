import { createHmac } from 'node:crypto';
import { WayForPayService } from './wayforpay.service';
import {
  formatWfpAmount,
  parseWfpCallbackBody,
  parseWfpOrderReference,
  wfpAmountToKopecks,
  wfpDate,
  wfpOrderReference,
  wfpTime,
} from './wayforpay.types';
import { wfpToInvoiceCallback } from './wayforpay-callback.mapper';

const ACCOUNT = 'test_merch';
const SECRET = 'test-secret';

const hmac = (fields: Array<string | number | undefined>) =>
  createHmac('md5', SECRET)
    .update(fields.map((f) => (f === undefined ? '' : String(f))).join(';'))
    .digest('hex');

function build(env: Record<string, string> = {}) {
  const service = new WayForPayService({
    getEnvConfig: () => ({
      WAYFORPAY_MERCHANT_ACCOUNT: ACCOUNT,
      WAYFORPAY_SECRET_KEY: SECRET,
      WAYFORPAY_MERCHANT_PASSWORD: 'regular-pass',
      WAYFORPAY_DOMAIN: 'www.coreleague.online',
      ...env,
    }),
  } as never);
  const calls: Array<{ url: string; body: string; type: string }> = [];
  let answer: unknown = { url: 'https://secure.wayforpay.com/page?vkh=abc' };
  service.fetchFn = (url, init) => {
    calls.push({
      url,
      body: init.body as string,
      type: (init.headers as Record<string, string>)['content-type'],
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), { status: 200 }),
    );
  };
  return {
    service,
    calls,
    answer: (next: unknown) => {
      answer = next;
    },
  };
}

/** A callback exactly as WayForPay signs it. */
function callback(over: Record<string, unknown> = {}) {
  const tx = {
    merchantAccount: ACCOUNT,
    orderReference: 'CORE-ABC234_T0K3N',
    amount: 450,
    currency: 'UAH',
    authCode: '541963',
    cardPan: '41****8217',
    transactionStatus: 'Approved',
    reasonCode: 1100,
    ...over,
  };
  return {
    ...tx,
    merchantSignature: hmac([
      tx.merchantAccount,
      tx.orderReference,
      tx.amount,
      tx.currency,
      tx.authCode,
      tx.cardPan,
      tx.transactionStatus,
      tx.reasonCode,
    ]),
    ...over,
  };
}

describe('WayForPayService', () => {
  it('is configured only with all three credentials', () => {
    expect(build().service.isConfigured()).toBe(true);
    expect(
      build({ WAYFORPAY_MERCHANT_PASSWORD: '' }).service.isConfigured(),
    ).toBe(false);
  });

  it('signs a Purchase and sends it as an offline form; a VIP purchase is a monthly regular payment', async () => {
    const { service, calls } = build();
    const page = await service.purchase({
      orderReference: 'VIP-ABC234_T0K3N',
      amount: 18000,
      productName: 'VIP-статус Core League — 1 місяць',
      serviceUrl: 'https://api.example/webhook/wayforpay',
      returnUrl: 'https://spa.example/me?vip=return',
      lifetimeSec: 3600,
      clientAccountId: 'player-1',
      regular: {
        dateNext: new Date(Date.UTC(2026, 10, 13, 10)),
        dateEnd: new Date(Date.UTC(2031, 10, 13, 10)),
      },
    });
    expect(page.url).toBe('https://secure.wayforpay.com/page?vkh=abc');
    expect(calls[0].url).toBe(
      'https://secure.wayforpay.com/pay?behavior=offline',
    );
    expect(calls[0].type).toBe('application/x-www-form-urlencoded');
    const form = Object.fromEntries(new URLSearchParams(calls[0].body));
    expect(form.amount).toBe('180');
    expect(form.currency).toBe('UAH');
    expect(form.merchantDomainName).toBe('www.coreleague.online');
    expect(form.serviceUrl).toBe('https://api.example/webhook/wayforpay');
    expect(form.regularMode).toBe('monthly');
    expect(form.regularAmount).toBe('180');
    expect(form.dateNext).toBe('13.11.2026');
    expect(form.merchantSignature).toBe(
      hmac([
        ACCOUNT,
        'www.coreleague.online',
        'VIP-ABC234_T0K3N',
        form.orderDate,
        '180',
        'UAH',
        form['productName[]'],
        1,
        '180',
      ]),
    );
  });

  it('a one-off purchase carries no regular fields', async () => {
    const { service, calls } = build();
    await service.purchase({
      orderReference: 'DON-ABC234_T0K3N',
      amount: 10050,
      productName: 'Донат',
      serviceUrl: 'https://api.example/webhook/wayforpay',
      returnUrl: 'https://spa.example/tournaments/t1',
      lifetimeSec: 600,
    });
    const form = Object.fromEntries(new URLSearchParams(calls[0].body));
    expect(form.amount).toBe('100.5');
    expect(form.regularMode).toBeUndefined();
  });

  it('throws when WayForPay answers without a page URL', async () => {
    const { service, answer } = build();
    answer({ reason: 'Invalid signature', reasonCode: 1113 });
    await expect(
      service.purchase({
        orderReference: 'X_1',
        amount: 100,
        productName: 'x',
        serviceUrl: 'https://a/b',
        returnUrl: 'https://a/c',
        lifetimeSec: 60,
      }),
    ).rejects.toThrow('purchase refused');
  });

  it('verifies a genuine callback and rejects a forged or foreign one', () => {
    const { service } = build();
    expect(service.verify(callback())).toBe(true);
    expect(
      service.verify(callback({ merchantSignature: 'f'.repeat(32) })),
    ).toBe(false);
    expect(service.verify(callback({ merchantAccount: 'someone_else' }))).toBe(
      false,
    );
    const tampered = { ...callback(), amount: 1 };
    expect(service.verify(tampered)).toBe(false);
  });

  it('answers a callback with the signed accept', () => {
    const { service } = build();
    const reply = service.acceptReply('CORE-ABC234_T0K3N');
    expect(reply.status).toBe('accept');
    expect(reply.signature).toBe(
      hmac(['CORE-ABC234_T0K3N', 'accept', reply.time]),
    );
  });

  it('CHECK_STATUS is signed over account and order', async () => {
    const { service, calls, answer } = build();
    answer({ transactionStatus: 'Declined', reasonCode: 1127 });
    const tx = await service.checkStatus('CORE-ABC234_T0K3N');
    expect(tx.orderReference).toBe('CORE-ABC234_T0K3N');
    const body = JSON.parse(calls[0].body) as Record<string, unknown>;
    expect(body.merchantSignature).toBe(hmac([ACCOUNT, 'CORE-ABC234_T0K3N']));
  });

  it('regularApi carries the merchant password', async () => {
    const { service, calls, answer } = build();
    answer({ reasonCode: 4100, status: 'Active' });
    const r = await service.regular('SUSPEND', 'VIP-ABC234_T0K3N');
    expect(Number(r.reasonCode)).toBe(4100);
    expect(JSON.parse(calls[0].body)).toEqual({
      requestType: 'SUSPEND',
      merchantAccount: ACCOUNT,
      merchantPassword: 'regular-pass',
      orderReference: 'VIP-ABC234_T0K3N',
    });
  });
});

describe('WayForPay helpers', () => {
  it('an order reference keeps the row reference and the page expiry', () => {
    const at = new Date('2026-10-14T12:00:00.000Z');
    const order = wfpOrderReference('CORE-ABC234', at);
    expect(order).toMatch(/^CORE-ABC234_[0-9A-Z]+$/);
    expect(parseWfpOrderReference(order)).toEqual({
      reference: 'CORE-ABC234',
      expiresAt: at,
    });
    expect(parseWfpOrderReference('p2_9ZgpZVsl3')).toBeNull();
  });

  it('amounts, dates and times are in the shapes WayForPay uses', () => {
    expect(formatWfpAmount(20000)).toBe('200');
    expect(formatWfpAmount(499)).toBe('4.99');
    expect(wfpAmountToKopecks('180.00')).toBe(18000);
    expect(wfpAmountToKopecks(undefined)).toBeNull();
    expect(wfpDate(new Date(Date.UTC(2026, 10, 3, 23, 30)))).toBe('04.11.2026');
    expect(wfpTime(1435698000)?.getTime()).toBe(1435698000_000);
    expect(wfpTime('1435698000')?.getTime()).toBe(1435698000_000);
    expect(wfpTime(null)).toBeNull();
  });

  it('reads JSON, URL-encoded JSON and plain form callbacks', () => {
    expect(parseWfpCallbackBody('{"orderReference":"a"}')).toEqual({
      orderReference: 'a',
    });
    expect(
      parseWfpCallbackBody(encodeURIComponent('{"orderReference":"a"}')),
    ).toEqual({ orderReference: 'a' });
    expect(parseWfpCallbackBody('orderReference=a&amount=1')).toEqual({
      orderReference: 'a',
      amount: '1',
    });
    expect(parseWfpCallbackBody('garbage')).toBeNull();
  });

  it('maps a transaction onto the acquiring callback the payment state machine reads', () => {
    expect(
      wfpToInvoiceCallback({
        orderReference: 'CORE-ABC234_T0K3N',
        transactionStatus: 'Approved',
        amount: '450.5',
        processingDate: 1792000000,
      }),
    ).toEqual({
      invoiceId: 'CORE-ABC234_T0K3N',
      reference: 'CORE-ABC234',
      status: 'success',
      amount: 45050,
      finalAmount: 45050,
      modifiedDate: new Date(1792000000_000).toISOString(),
    });
    const status = (transactionStatus: string) =>
      wfpToInvoiceCallback({ orderReference: 'A_1', transactionStatus }).status;
    // A decline leaves the page payable: never a failure that drops it.
    expect(status('Declined')).toBe('processing');
    expect(status('Expired')).toBe('expired');
    expect(status('Refunded')).toBe('reversed');
    expect(status('InProcessing')).toBe('processing');
  });
});
