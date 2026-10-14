import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { LEGAL_VERSION, PRICING_CURRENCY } from './legal.constants';
import {
  PaymentConsent,
  PaymentConsentProduct,
  type TPaymentConsentProvider,
} from './payment-consent.entity';

/** Refusal when the consent box was not ticked. */
export const CONSENT_REQUIRED_MESSAGE =
  'Потрібна згода з Договором публічної оферти та Політикою повернення коштів';

/** Refusal when the payer agreed to an older version of the documents. */
export const LEGAL_VERSION_OUTDATED_MESSAGE =
  'Умови оновлено — оновіть сторінку й погодьтеся з актуальною версією';

/** The consent fields every payment intent carries (see PaymentConsentDto). */
export type TPaymentConsentInput = {
  consent?: unknown;
  legalVersion?: unknown;
};

/**
 * Refuses a payment intent without explicit consent to the current legal
 * documents. Runs first in every intent, before any row or payment page is
 * created: the client is never trusted to have shown the checkbox.
 */
export function assertPaymentConsent(
  input: TPaymentConsentInput | null | undefined,
): void {
  if (input?.consent !== true) {
    throw new BadRequestException({
      error: 'consent_required',
      message: CONSENT_REQUIRED_MESSAGE,
    });
  }
  if (input.legalVersion !== LEGAL_VERSION) {
    throw new BadRequestException({
      error: 'legal_version_outdated',
      message: LEGAL_VERSION_OUTDATED_MESSAGE,
    });
  }
}

/**
 * Appends one consent row through `manager`, i.e. inside the caller's
 * transaction that records the newly minted payment page: either both rows
 * land or neither does. Call it once per new page, never for a reused one.
 */
export async function recordPaymentConsent(
  manager: EntityManager,
  row: {
    playerId: string | null;
    product: PaymentConsentProduct;
    reference: string;
    amountKopecks: number;
    provider: TPaymentConsentProvider;
  },
): Promise<void> {
  await manager.getRepository(PaymentConsent).insert({
    playerId: row.playerId,
    legalVersion: LEGAL_VERSION,
    product: row.product,
    reference: row.reference,
    amountKopecks: row.amountKopecks,
    currency: PRICING_CURRENCY,
    provider: row.provider,
  });
}
