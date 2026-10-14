/**
 * Version of the public legal documents (offer, terms, refund policy, privacy,
 * rules, contacts, prices) the payer agrees to at checkout.
 *
 * Must equal `legalVersion` in CoreFrontend `legal/config.json` and the
 * `version` in the front matter of every legal page. Bump all three together
 * whenever a text changes: every payment intent sent with an older version is
 * refused until the page is reloaded, and `payment_consent` records which
 * version each payment was made under.
 */
export const LEGAL_VERSION = '2026-10-14';

/** Every Core League price is in hryvnias. */
export const PRICING_CURRENCY = 'UAH';

/**
 * What the payer sees as the product on the payment page and the card
 * statement (WayForPay `productName`, Monobank `destination`). Fixed wording
 * only: never an admin-typed tournament name, and never betting, gambling or
 * "donation" vocabulary (see product-names.spec.ts).
 */
export const ENTRY_FEE_PRODUCT_NAME =
  'Вступний внесок за участь у турнірі Core League';
export const SUPPORT_PRODUCT_NAME = 'Добровільна підтримка Core League';
export const VIP_PRODUCT_NAME = 'VIP-статус Core League — 1 місяць';
export const VIP_RENEWAL_PRODUCT_NAME =
  'Продовження VIP-статусу Core League — 1 місяць';

export const PAYMENT_PRODUCT_NAMES: readonly string[] = [
  ENTRY_FEE_PRODUCT_NAME,
  SUPPORT_PRODUCT_NAME,
  VIP_PRODUCT_NAME,
  VIP_RENEWAL_PRODUCT_NAME,
];
