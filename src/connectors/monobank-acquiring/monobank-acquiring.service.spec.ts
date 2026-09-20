import { createSign, generateKeyPairSync } from 'node:crypto';
import { MonobankAcquiringService } from './monobank-acquiring.service';

type THttpStub = {
  get: jest.Mock;
  post: jest.Mock;
};

describe('MonobankAcquiringService', () => {
  let http: THttpStub;
  let service: MonobankAcquiringService;

  const config = {
    getEnvConfig: () => ({ MONOBANK_MERCHANT_TOKEN: 'merchant-token' }),
  };

  beforeEach(() => {
    http = { get: jest.fn(), post: jest.fn() };
    service = new MonobankAcquiringService(http as never, config as never);
  });

  it('creates an invoice with kopecks, UAH and the reference', async () => {
    http.post.mockResolvedValue({
      invoiceId: 'inv_1',
      pageUrl: 'https://pay.mbnk.biz/inv_1',
    });

    const created = await service.createInvoice({
      amount: 50000,
      reference: 'CORE-7F3K9Q',
      destination: 'Внесок за участь у турнірі',
      redirectUrl: 'https://spa.example/tournaments/t1',
      webHookUrl: 'https://api.example/webhook/monobank/acquiring',
      validitySec: 3600,
    });

    expect(created).toEqual({
      invoiceId: 'inv_1',
      pageUrl: 'https://pay.mbnk.biz/inv_1',
    });

    // `jest.Mock`'s untyped generics make `.mock.calls[0]` resolve to `any`;
    // cast to the args we know `post()` is called with so the assertions
    // below don't trip `no-unsafe-*` lint rules.
    const [url, body, requestConfig] = http.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('/api/merchant/invoice/create');
    expect(body).toMatchObject({
      amount: 50000,
      ccy: 980,
      paymentType: 'debit',
      validity: 3600,
      redirectUrl: 'https://spa.example/tournaments/t1',
      webHookUrl: 'https://api.example/webhook/monobank/acquiring',
      merchantPaymInfo: {
        reference: 'CORE-7F3K9Q',
        destination: 'Внесок за участь у турнірі',
      },
    });
    expect(requestConfig.headers['X-Token']).toBe('merchant-token');
  });

  it('rejects when the merchant token is not configured', async () => {
    const unconfigured = new MonobankAcquiringService(
      http as never,
      { getEnvConfig: () => ({ MONOBANK_MERCHANT_TOKEN: '' }) } as never,
    );
    await expect(
      unconfigured.createInvoice({
        amount: 1,
        reference: 'CORE-1',
        destination: 'x',
        redirectUrl: 'https://a',
        webHookUrl: 'https://b',
        validitySec: 900,
      }),
    ).rejects.toThrow('MONOBANK_MERCHANT_TOKEN');
    expect(http.post).not.toHaveBeenCalled();
  });

  it('fetches the public key once and reuses it', async () => {
    http.get.mockResolvedValue({ key: 'a2V5' });
    await service.getPublicKey();
    await service.getPublicKey();
    expect(http.get).toHaveBeenCalledTimes(1);
    const [pubkeyUrl] = http.get.mock.calls[0] as [string];
    expect(pubkeyUrl).toBe('/api/merchant/pubkey');
  });

  it('refetches the key once when verification fails, then gives up', async () => {
    http.get
      .mockResolvedValueOnce({ key: 'stale' })
      .mockResolvedValueOnce({ key: 'fresh' });

    const verified = await service.verifyCallback(Buffer.from('{}'), 'c2ln');

    expect(verified).toBe(false);
    // once for the initial key, once for the post-failure refresh
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('verifies a genuine callback and does not refetch the key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const rawBody = Buffer.from('{"invoiceId":"inv_1","status":"success"}');
    const signatureB64 = createSign('SHA256')
      .update(rawBody)
      .sign(privateKey)
      .toString('base64');
    const publicKeyB64 = Buffer.from(
      publicKey.export({ type: 'spki', format: 'pem' }) as string,
      'utf8',
    ).toString('base64');
    http.get.mockResolvedValue({ key: publicKeyB64 });

    const verified = await service.verifyCallback(rawBody, signatureB64);

    expect(verified).toBe(true);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('does not call the bank when the signature is missing', async () => {
    const verified = await service.verifyCallback(Buffer.from('{}'), '');

    expect(verified).toBe(false);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('resolves false, not a rejection, when the key refresh fails after a bad signature', async () => {
    http.get
      .mockResolvedValueOnce({ key: 'stale' })
      .mockRejectedValueOnce(new Error('network down'));

    await expect(
      service.verifyCallback(Buffer.from('{}'), 'c2ln'),
    ).resolves.toBe(false);
  });

  it('fetches invoice status', async () => {
    http.get.mockResolvedValue({ invoiceId: 'inv_1', status: 'processing' });

    const status = await service.getInvoiceStatus('inv_1');

    expect(status).toEqual({ invoiceId: 'inv_1', status: 'processing' });
    const [url] = http.get.mock.calls[0] as [string];
    expect(url).toBe('/api/merchant/invoice/status?invoiceId=inv_1');
  });

  it('rejects rather than throwing synchronously when the merchant token is not configured', async () => {
    const unconfigured = new MonobankAcquiringService(
      http as never,
      {
        getEnvConfig: () => ({ MONOBANK_MERCHANT_TOKEN: '' }),
      } as never,
    );

    let threwSynchronously = false;
    let result: Promise<unknown> | undefined;
    try {
      result = unconfigured.getInvoiceStatus('inv_1');
    } catch {
      threwSynchronously = true;
    }

    expect(threwSynchronously).toBe(false);
    await expect(result).rejects.toThrow('MONOBANK_MERCHANT_TOKEN');
    expect(http.get).not.toHaveBeenCalled();
  });
});
