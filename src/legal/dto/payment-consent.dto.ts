import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { LEGAL_VERSION } from '../legal.constants';

/**
 * Checkout consent, sent with every payment intent (`POST /vip/checkout`,
 * `POST /tournaments/:id/payments/intent`, `POST /tournaments/:id/donations/intent`).
 *
 * Both fields are required by the service, not by the validation pipe, so a
 * missing or wrong value is refused with the exact Ukrainian message the
 * checkout shows (see `assertPaymentConsent`), not a generic pipe error.
 */
export class PaymentConsentDto {
  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      'The payer ticked "I agree to the Offer, Terms and Refund Policy". Anything but true → 400 consent_required.',
  })
  @IsOptional()
  consent: boolean;

  @ApiProperty({
    example: LEGAL_VERSION,
    description:
      'Version of the legal documents the payer agreed to (`legalVersion` of GET /public/pricing). ' +
      'Anything but the current version → 400 legal_version_outdated.',
  })
  @IsOptional()
  legalVersion: string;
}
