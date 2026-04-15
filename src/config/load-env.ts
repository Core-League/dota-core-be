import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

dotenv.config();

const envDevPath = resolve(process.cwd(), '.env.dev');
if (existsSync(envDevPath)) {
  const parsed = dotenv.parse(readFileSync(envDevPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== '') {
      process.env[key] = value;
    }
  }
}
