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
