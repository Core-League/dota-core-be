import {
  INVOICE_MAX_VALIDITY_SEC,
  INVOICE_MIN_VALIDITY_SEC,
  invoiceValiditySeconds,
} from './invoice-validity';

describe('invoiceValiditySeconds', () => {
  const now = new Date('2026-09-19T12:00:00Z');
  const inHours = (h: number) => new Date(now.getTime() + h * 3600 * 1000);

  it('caps at 24 hours when registration is far away', () => {
    expect(invoiceValiditySeconds(now, inHours(240))).toBe(
      INVOICE_MAX_VALIDITY_SEC,
    );
  });

  it('shortens to the remaining registration window', () => {
    expect(invoiceValiditySeconds(now, inHours(3))).toBe(3 * 3600);
  });

  it('floors at the minimum when registration is nearly over', () => {
    expect(invoiceValiditySeconds(now, inHours(0.05))).toBe(
      INVOICE_MIN_VALIDITY_SEC,
    );
  });

  it('floors at the minimum when the deadline has already passed', () => {
    expect(invoiceValiditySeconds(now, inHours(-5))).toBe(
      INVOICE_MIN_VALIDITY_SEC,
    );
  });

  it('returns the minimum when remaining exactly equals the floor', () => {
    const registrationEndsAt = new Date(
      now.getTime() + INVOICE_MIN_VALIDITY_SEC * 1000,
    );
    expect(invoiceValiditySeconds(now, registrationEndsAt)).toBe(
      INVOICE_MIN_VALIDITY_SEC,
    );
  });

  it('returns the maximum when remaining exactly equals the cap', () => {
    const registrationEndsAt = new Date(
      now.getTime() + INVOICE_MAX_VALIDITY_SEC * 1000,
    );
    expect(invoiceValiditySeconds(now, registrationEndsAt)).toBe(
      INVOICE_MAX_VALIDITY_SEC,
    );
  });

  it('returns the minimum when registrationEndsAt is an Invalid Date', () => {
    const invalidDate = new Date('not-a-date');
    expect(invoiceValiditySeconds(now, invalidDate)).toBe(
      INVOICE_MIN_VALIDITY_SEC,
    );
  });
});
