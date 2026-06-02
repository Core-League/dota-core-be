import { z } from 'zod';
import { EnvTypes } from '../enums/common/EnvTypes';

/**
 * Single source of truth for process.env. Parsed once at boot (see
 * createConfigNamespace) so the app fails fast on a misconfigured environment.
 * Values stay as strings to preserve the existing `Number(...)` / `?? default`
 * call-site logic; only NODE_ENV and JWT_SECRET carry real constraints.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(EnvTypes),

  PORT: z.string(),
  API_BASE_URL: z.string(),
  CORS_ORIGINS: z.string(),
  CORS_CREDENTIALS: z.string(),

  // Database — prefer DATABASE_URL (Supabase URI); else discrete DB_* vars.
  // DATABASE_URL: z.string(),
  DB_HOST: z.string(),
  DB_PORT: z.string(),
  DB_USER: z.string(),
  DB_PASS: z.string(),
  DB_NAME: z.string(),
  // DB_SSL: z.string(),
  // DB_SSL_REJECT_UNAUTHORIZED: z.string(),
  // SUPABASE_DB_USE_SSL: z.string(),

  // Discord OAuth + bot/guild sync
  // DISCORD_CLIENT_ID: z.string(),
  // DISCORD_CLIENT_SECRET: z.string(),
  // DISCORD_REDIRECT_URI: z.string(),
  // DISCORD_FRONTEND_REDIRECT: z.string(),
  // DISCORD_SCOPES: z.string(),
  // DISCORD_BOT_TOKEN: z.string(),
  // DISCORD_SYNC_GUILD_ID: z.string(),
  // DISCORD_VERIFIED_ROLE_ID: z.string(),
  // DISCORD_ROLE_ID_CAPTAIN: z.string(),
  // DISCORD_ROLE_ID_ADMIN: z.string(),

  // Steam OpenID
  // STEAM_CALLBACK_URI: z.string(),
  // STEAM_FRONTEND_REDIRECT: z.string(),
  // STEAM_API_KEY: z.string(),

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

  // Challonge / Dota2 league / Stratz / Duelo integrations
  // CHALLONGE_API_KEY: z.string(),
  // DOTA_OAUTH_TOKEN: z.string(),
  // DOTA_LEAGUE_ID: z.string(),
  // DOTA_SESSION_ID: z.string(),
  // DOTA_OAUTH_INFO: z.string(),
  // STARTZ_API_KEY: z.string(),
  // DUELO_API_KEY: z.string(),

  // Monobank Personal API (https://api.monobank.ua). Token is the X-Token
  // header; base URL defaults to the public host at the call site.
  MONOBANK_TOKEN: z.string(),
  MONOBANK_API_URL: z.string(),
  MONOBANK_HTTP_TIMEOUT: z.string(),
  MONOBANK_ACCOUNT_ID: z.string(),

  BYPASS_TEAM_VERIFICATION: z.string(),
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
