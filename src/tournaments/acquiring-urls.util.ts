import { InternalServerErrorException } from '@nestjs/common';
import {
  apiOriginFrom,
  spaOriginFrom,
  type TRequestHeaders,
} from './request-origin.util';

/** Path on THIS api where Monobank posts acquiring invoice callbacks. */
export const ACQUIRING_WEBHOOK_PATH = '/webhook/monobank/acquiring';

/** True when a derived api/spa origin string carries a real host, not just a scheme. */
function hasHost(origin: string): boolean {
  try {
    return new URL(origin).host.length > 0;
  } catch {
    return false;
  }
}

/**
 * The invoice's `webHookUrl`, derived from the request that created it.
 *
 * apiOriginFrom falls back to a bare "http://" when neither `host` nor
 * `x-forwarded-host` is present. Putting that on a real invoice's webHookUrl
 * would mean Monobank's callback has nowhere to land — a payment that goes
 * through but never settles, silently. Fail loudly here instead.
 */
export function acquiringWebHookUrlFrom(headers: TRequestHeaders): string {
  const apiOrigin = apiOriginFrom(headers);
  if (!hasHost(apiOrigin)) {
    throw new InternalServerErrorException(
      "Cannot derive this API's public host from the request headers — refusing to create an invoice with an unreachable webHookUrl",
    );
  }
  return `${apiOrigin}${ACQUIRING_WEBHOOK_PATH}`;
}

/**
 * Where Monobank returns the payer after paying: the tournament page on the SPA.
 *
 * spaOriginFrom returns null only when CORS_ORIGINS has no usable entries —
 * the same class of misconfiguration as the hostless api origin above.
 * Falling back to the api origin would hand the payer a redirect that 404s
 * right after they have paid; fail loudly here instead, before the invoice is
 * even created.
 */
export function tournamentRedirectUrlFrom(
  headers: TRequestHeaders,
  corsOrigins: string | undefined,
  tournamentId: string,
): string {
  const allowed = (corsOrigins ?? '').split(',');
  const spa = spaOriginFrom(headers, allowed);
  if (!spa) {
    throw new InternalServerErrorException(
      'Cannot derive a SPA origin to redirect the payer to after payment — check CORS_ORIGINS',
    );
  }
  return `${spa}/tournaments/${tournamentId}`;
}
