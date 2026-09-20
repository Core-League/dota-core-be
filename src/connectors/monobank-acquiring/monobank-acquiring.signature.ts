import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

const PEM_PREFIX = '-----BEGIN';

/**
 * Monobank's `GET /api/merchant/pubkey` returns a base64 "x.509 public key".
 * In practice that decodes to either a PEM block or raw DER depending on the
 * integration, so both are accepted rather than betting on one.
 */
function toPublicKey(publicKeyB64: string): KeyObject {
  const decoded = Buffer.from(publicKeyB64, 'base64');
  const asText = decoded.toString('utf8').trim();
  if (asText.startsWith(PEM_PREFIX)) {
    return createPublicKey({ key: asText, format: 'pem' });
  }
  return createPublicKey({ key: decoded, format: 'der', type: 'spki' });
}

/**
 * Verifies an acquiring webhook's `x-sign` header.
 *
 * The digest MUST be taken over the exact bytes received — re-serialising the
 * parsed JSON changes whitespace and key order and fails every time. See the
 * `rawBody: true` bootstrap option in the v1 entry point.
 *
 * Returns false (never throws) so a malformed push is a 403, not a 500.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  if (!signatureB64 || !publicKeyB64) return false;
  try {
    return createVerify('SHA256')
      .update(rawBody)
      .verify(toPublicKey(publicKeyB64), Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
