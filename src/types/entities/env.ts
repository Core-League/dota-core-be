import { z } from 'zod';
import { EnvTypes } from '../enums/common/EnvTypes';

/**
 * Single source of truth for process.env, parsed once at boot (see
 * createConfigNamespace) so the app fails fast on misconfiguration. Values stay
 * strings for the existing call-site `Number(...)` / `?? default` logic; only
 * NODE_ENV and JWT_SECRET carry real constraints.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(EnvTypes),

  PORT: z.string(),
  API_BASE_URL: z.string(),
  CORS_ORIGINS: z.string(),
  CORS_CREDENTIALS: z.string(),

  DB_HOST: z.string(),
  DB_PORT: z.string(),
  DB_USER: z.string(),
  DB_PASS: z.string(),
  DB_NAME: z.string(),

  // App JWT (HS256). Required — the API refuses to start without it.
  JWT_SECRET: z
    .string({
      error:
        'JWT_SECRET is missing or empty. Set it in process.env — e.g. .env locally, or deploy environment/secrets. Generate: openssl rand -base64 32',
    })
    .trim()
    .min(
      1,
      'JWT_SECRET is missing or empty. Set it in process.env — e.g. .env locally, or deploy environment/secrets. Generate: openssl rand -base64 32',
    ),
  JWT_EXPIRES_SEC: z.string(),

  // Monobank Personal API (https://api.monobank.ua). Token is the X-Token
  // header; base URL defaults to the public host at the call site.
  MONOBANK_TOKEN: z.string(),
  MONOBANK_API_URL: z.string(),
  MONOBANK_HTTP_TIMEOUT: z.string(),
  MONOBANK_ACCOUNT_ID: z.string(),

  // Monobank ACQUIRING (ФОП) merchant token — a different credential from
  // MONOBANK_TOKEN, which is the Personal API token used for statements.
  // Issued in the merchant cabinet; Monobank also publishes a sandbox token.
  MONOBANK_MERCHANT_TOKEN: z.string().default(''),

  // OPTIONAL. Extra account/jar ids whose full transaction traffic is stored and
  // classified, comma-separated, on top of MONOBANK_ACCOUNT_ID. List a jar here
  // to see its transactions in the finance views. Ids come from
  // `GET /bank/webhook` (client-info `jars[].id`), NOT from the
  // `send.monobank.ua/{sendId}` link.
  MONOBANK_ACCOUNT_IDS: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * DB-only subset for the TypeORM CLI data source, which runs outside the Nest
 * DI container and must work for migrations without requiring JWT_SECRET.
 */
export const DbEnvSchema = EnvSchema.pick({
  DB_HOST: true,
  DB_PORT: true,
  DB_USER: true,
  DB_PASS: true,
  DB_NAME: true,
});

export type DbEnv = z.infer<typeof DbEnvSchema>;
