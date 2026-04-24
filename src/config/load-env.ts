import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const envDevPath = resolve(process.cwd(), '.env.dev');
// .env.dev must not apply on staging/production — it would override e.g. DISCORD_REDIRECT_URI.
if (
  (nodeEnv === 'development' || nodeEnv === 'test') &&
  existsSync(envDevPath)
) {
  const parsed = dotenv.parse(readFileSync(envDevPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== '') {
      process.env[key] = value;
    }
  }
}
