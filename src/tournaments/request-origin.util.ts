export type TRequestHeaders = Record<string, string | string[] | undefined>;

function firstValue(raw: string | string[] | undefined): string | null {
  if (raw === undefined) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const first = value?.split(',')[0]?.trim();
  return first ? first : null;
}

/**
 * Public origin of THIS api, for the invoice's `webHookUrl`.
 *
 * Derived from the request rather than `API_BASE_URL`: that env var addresses
 * the v1 host and once pointed a Monobank webhook at the wrong app of a
 * two-app deployment, which silently stopped every entry fee from reconciling.
 * The intent request necessarily arrives at the app that must receive the
 * callback, so the request itself is the reliable source.
 */
export function apiOriginFrom(headers: TRequestHeaders): string {
  const proto = firstValue(headers['x-forwarded-proto']) ?? 'http';
  const host =
    firstValue(headers['x-forwarded-host']) ?? firstValue(headers.host) ?? '';
  return `${proto}://${host}`;
}

/**
 * Public origin of the SPA, for the invoice's `redirectUrl` — where Monobank
 * returns the captain after paying. This is NOT the api origin.
 *
 * The browser sets `Origin` on the XHR that creates the intent, which is the
 * frontend's own origin. It is checked against the configured allow-list so a
 * forged header cannot turn our invoice into an open redirect; anything
 * unrecognised falls back to the first configured origin.
 */
export function spaOriginFrom(
  headers: TRequestHeaders,
  allowedOrigins: string[],
): string | null {
  const allowed = allowedOrigins.map((o) => o.trim()).filter(Boolean);
  const origin = firstValue(headers.origin);
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0] ?? null;
}
