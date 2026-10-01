/** VIP price per month, kopecks (250 ₴). */
export const VIP_MONTHLY_PRICE_KOPECKS = 25_000;

/** A paid VIP period; renewals extend `vipUntil` by the same step. */
export const VIP_PERIOD_MONTHS = 1;

/** How long the first-payment invoice stays payable. */
export const VIP_INVOICE_VALIDITY_SEC = 60 * 60;

/** Renewal charges start this long before `vipUntil`, so a paid VIP never lapses. */
export const VIP_RENEWAL_LEAD_HOURS = 12;

/** A failed renewal is retried after this pause… */
export const VIP_RENEWAL_RETRY_HOURS = 24;

/** …up to this many times in a row, then auto-renewal is switched off. */
export const VIP_RENEWAL_MAX_ATTEMPTS = 3;

/** A claimed renewal nobody settled for this long may be claimed again. */
export const VIP_RENEWAL_CLAIM_TTL_MINUTES = 30;

/** VIP discount on every tournament entry fee, percent (applied when the paying captain is VIP). */
export const VIP_TOURNAMENT_DISCOUNT_PERCENT = 10;

/**
 * `vipUntil` of a lifetime VIP (admin grant). A far-future date instead of a
 * separate flag, so every `vipUntil > now` check keeps working unchanged.
 */
export const VIP_LIFETIME_UNTIL = new Date('9999-12-31T00:00:00.000Z');

/** Upper bound of one admin grant, months. */
export const VIP_ADMIN_GRANT_MAX_MONTHS = 120;

/** Prefix of `vip_payment.reference`; keeps VIP callbacks apart from `CORE-` / `DON-`. */
export const VIP_REFERENCE_PREFIX = 'VIP-';

/**
 * Card frame colours a VIP may pick (`#RRGGBB`, upper-case).
 *
 * A closed palette rather than a free picker on purpose: roles own colours on
 * the site (admin gold / red, media violet, player blue, captain amber and the
 * default cyan frame), and a free picker would let anyone dress up as staff.
 * None of these sit close to those hues. Mirrored on the frontend.
 */
export const VIP_FRAME_COLORS = [
  '#10B981', // emerald
  '#A3E635', // lime
  '#F97316', // tangerine
  '#FDA4AF', // powder pink
  '#EC4899', // pink
  '#9D174D', // berry
  '#E2E8F0', // silver
  '#64748B', // graphite
] as const;

export type TVipFrameColor = (typeof VIP_FRAME_COLORS)[number];

export function isVipFrameColor(value: string): value is TVipFrameColor {
  return (VIP_FRAME_COLORS as readonly string[]).includes(value);
}

export enum VipPaymentKind {
  /** First payment through the Monobank page; tokenizes the card. */
  INITIAL = 'INITIAL',
  /** Merchant-initiated charge of the saved token. */
  RENEWAL = 'RENEWAL',
}

export enum VipPaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
}
