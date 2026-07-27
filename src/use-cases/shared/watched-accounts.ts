import type { Env } from '../../types/entities/env';

/**
 * The account/jar ids whose **full** traffic this app stores and classifies: the
 * primary `MONOBANK_ACCOUNT_ID` plus every id in `MONOBANK_ACCOUNT_IDS`.
 *
 * Entry-fee reconciliation is deliberately NOT gated on this list — it matches
 * globally-unique `CORE-…` references, so it works for a brand-new tournament jar
 * with no config change. Listing a jar here only adds finance-side visibility for
 * its non-payment transactions.
 *
 * Single source of truth for the rule: it is applied on the push path
 * ({@link IngestionService}), on the backfill path ({@link SyncService}), and
 * reported by the admin webhook status endpoint. Three private copies had already
 * drifted apart once.
 */
export function watchedAccountIds(env: Env): string[] {
  const extras = env.MONOBANK_ACCOUNT_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set([env.MONOBANK_ACCOUNT_ID, ...extras].filter(Boolean))];
}

/** Whether a push/statement for `account` should be stored and classified. */
export function isWatchedAccount(account: string, env: Env): boolean {
  return watchedAccountIds(env).includes(account);
}
