import type { TRequestHeaders } from './request-origin.util';

/** The subset of `JwtService` this helper needs, so tests can stub it. */
export type TJwtVerifier = {
  verify<T extends object = any>(token: string): T;
};

type TAccessTokenPayload = { sub?: unknown; typ?: unknown };

/**
 * Player id from an *optional* `Authorization: Bearer` header, or null.
 *
 * Used where guests are welcome but a logged-in caller should still be
 * attributed (donations). Deliberately not a guard: a guard would answer 401,
 * and the SPA's axios interceptor hard-redirects on 401, which would kick
 * every guest off the page. Anything short of a valid access token — no
 * header, a non-bearer scheme, an expired or forged token, or one of our
 * short-lived `typ`-tagged state tokens — simply yields null.
 */
export function playerIdFromOptionalBearer(
  headers: TRequestHeaders,
  jwt: TJwtVerifier,
): string | null {
  const raw = headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return null;

  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (!token || rest.length || scheme.toLowerCase() !== 'bearer') return null;

  try {
    const payload = jwt.verify<TAccessTokenPayload>(token);
    // Access tokens carry only `sub`; OAuth-state and Steam-link tokens are
    // tagged with `typ` and must never be accepted as a login.
    if (payload.typ !== undefined) return null;
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
