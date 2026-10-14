import { ApiProperty } from '@nestjs/swagger';

/**
 * A freshly minted voluntary support payment: the reference carried on the
 * payment page, the amount requested, and the hosted page to pay on.
 */
export class TournamentDonationIntentDto {
  @ApiProperty({
    description:
      'Unique DON- code carried as the payment reference (shown to the payer).',
  })
  reference: string;

  @ApiProperty({ description: 'Support amount requested, in kopecks.' })
  amount: number;

  @ApiProperty({
    nullable: true,
    description:
      'Hosted payment page of the payment provider, or null when no provider is configured.',
  })
  pageUrl: string | null;
}
