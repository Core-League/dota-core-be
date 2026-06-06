import * as dotenv from 'dotenv';
import { resolve } from 'node:path';

function getEnvFileName() {
  switch (process.env.NODE_ENV) {
    case 'production':
      return '.env';
    case 'staging':
      return '.env.staging';
    default:
      return '.env.dev';
  }
}

dotenv.config({
  path: resolve(process.cwd(), getEnvFileName()),
});

console.log('[env] NODE_ENV             =', process.env.NODE_ENV);
console.log('[env] DISCORD_REDIRECT_URI =', process.env.DISCORD_REDIRECT_URI);
console.log('[env] DISCORD_CLIENT_ID    =', process.env.DISCORD_CLIENT_ID);
