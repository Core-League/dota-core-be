import type { DataSourceOptions } from 'typeorm';

/**
 * Builds Postgres options for TypeORM.
 * Prefer `DATABASE_URL` (Supabase “Connection string” URI from Project Settings → Database).
 * Or set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` (e.g. local Docker).
 *
 * For Supabase + TypeORM, use **Session pooler** or **direct (5432)** connection from the dashboard.
 * Transaction pooler (6543) can break some ORM features.
 */
export function getPostgresDataSourceOptions(): DataSourceOptions & {
  type: 'postgres';
} {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    return {
      type: 'postgres',
      url,
      ssl: urlHasSslMode(url) ? undefined : resolveSslOption(),
    };
  }

  const host = process.env.DB_HOST?.trim();
  if (!host) {
    throw new Error(
      'Database not configured: set DATABASE_URL (Supabase) or DB_HOST (+ DB_USER, DB_PASS, DB_NAME).',
    );
  }

  return {
    type: 'postgres',
    host,
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: resolveSslOption(),
  };
}

function urlHasSslMode(url: string): boolean {
  try {
    const u = new URL(url.replace(/^postgresql:/, 'http:'));
    return u.searchParams.has('sslmode');
  } catch {
    return /sslmode=/i.test(url);
  }
}

/** Supabase hosted DB requires TLS; URI usually includes sslmode=require. */
function resolveSslOption():
  | boolean
  | { rejectUnauthorized: boolean }
  | undefined {
  if (process.env.DB_SSL === 'false') {
    return false;
  }
  if (
    process.env.DB_SSL === 'true' ||
    !!process.env.SUPABASE_DB_USE_SSL?.trim()
  ) {
    return {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    };
  }
  return undefined;
}
