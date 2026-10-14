/** VIP price per month, kopecks (200 ₴). */
export const VIP_MONTHLY_PRICE_KOPECKS = 20_000;

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

/**
 * Discount on every future VIP month for players who had paid through
 * Monobank when the checkout moved to WayForPay (owner 2026-10-14): their
 * Monobank auto-renewal was cancelled by the switch.
 */
export const VIP_SWITCH_DISCOUNT_PERCENT = 10;

/**
 * WayForPay charges a regular payment some time on its due day (Kyiv), and
 * the charge is only seen through a callback or regularApi STATUS. VIP is
 * kept this long past the next scheduled charge, so it never lapses while
 * the charge is on its way.
 */
export const VIP_WFP_CHARGE_GRACE_HOURS = 36;

/** No WayForPay charge seen yet: STATUS is read again after this pause… */
export const VIP_WFP_RECHECK_HOURS = 6;

/** …until VIP has been over for this long; then the subscription is given up. */
export const VIP_WFP_GIVE_UP_HOURS = 72;

/** How long a WayForPay regular payment is scheduled for (it runs until cancelled well before that). */
export const VIP_WFP_REGULAR_YEARS = 5;

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
  /** First payment on the payment page (Monobank tokenizes the card, WayForPay starts the regular payment). */
  INITIAL = 'INITIAL',
  /** A monthly charge: Monobank token charged by us, or WayForPay's own regular charge. */
  RENEWAL = 'RENEWAL',
}

/** Who renews a VIP subscription. */
export enum VipProvider {
  MONO = 'mono',
  WAYFORPAY = 'wayforpay',
}

export enum VipPaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  /** Paid, then refunded or voided at the provider: its month was taken back once. */
  REFUNDED = 'REFUNDED',
}
