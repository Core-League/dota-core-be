import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Bot account passwords never sit in the database in clear text. They are
 * AES-256-GCM encrypted with `HOSTBOT_SECRET_KEY` (32 random bytes, base64),
 * which lives only in the environment. Token layout, base64-encoded:
 * `iv (12 bytes) | auth tag (16 bytes) | ciphertext`.
 *
 * Generate a key: `npm run bot:keygen`.
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function loadKey(): Buffer {
  const raw = process.env.HOSTBOT_SECRET_KEY?.trim();
  if (!raw) {
    throw new Error(
      'HOSTBOT_SECRET_KEY is not set — generate one with `npm run bot:keygen`',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'HOSTBOT_SECRET_KEY must decode to exactly 32 bytes (base64 of 32 random bytes)',
    );
  }
  return key;
}

export function encryptHostBotPassword(plain: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptHostBotPassword(token: string): string {
  const key = loadKey();
  const buf = Buffer.from(token, 'base64');
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Corrupt host bot password token');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const data = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}

export function generateHostBotSecretKey(): string {
  return randomBytes(32).toString('base64');
}

if (require.main === module) {
  // `npm run bot:keygen`
  process.stdout.write(`${generateHostBotSecretKey()}\n`);
}
