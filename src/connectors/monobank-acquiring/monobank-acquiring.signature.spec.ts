import { generateKeyPairSync, createSign } from 'node:crypto';
import { verifyWebhookSignature } from './monobank-acquiring.signature';

/** Monobank signs with ECDSA/SHA256 and sends an ASN.1 DER signature, base64-encoded. */
describe('verifyWebhookSignature', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });

  const body = Buffer.from('{"invoiceId":"inv_1","status":"success"}', 'utf8');

  const sign = (payload: Buffer): string =>
    createSign('SHA256').update(payload).sign(privateKey).toString('base64');

  /** The key as Monobank may send it: base64 of a PEM block. */
  const pemB64 = Buffer.from(
    publicKey.export({ type: 'spki', format: 'pem' }) as string,
    'utf8',
  ).toString('base64');

  /** The key as Monobank may equally send it: base64 of raw DER. */
  const derB64 = (
    publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  ).toString('base64');

  it('accepts a valid signature when the key arrives base64-PEM', () => {
    expect(verifyWebhookSignature(body, sign(body), pemB64)).toBe(true);
  });

  it('accepts a valid signature when the key arrives base64-DER', () => {
    expect(verifyWebhookSignature(body, sign(body), derB64)).toBe(true);
  });

  it('rejects a signature made over different bytes', () => {
    const other = Buffer.from('{"invoiceId":"inv_1","status":"failure"}');
    expect(verifyWebhookSignature(body, sign(other), pemB64)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const stranger = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const foreign = createSign('SHA256')
      .update(body)
      .sign(stranger.privateKey)
      .toString('base64');
    expect(verifyWebhookSignature(body, foreign, pemB64)).toBe(false);
  });

  it('returns false rather than throwing on malformed input', () => {
    expect(verifyWebhookSignature(body, 'not-base64!!', pemB64)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), 'garbage')).toBe(false);
    expect(verifyWebhookSignature(body, '', pemB64)).toBe(false);
  });
});
