import { ApiProperty } from '@nestjs/swagger';

/**
 * A freshly minted donation intent: the reference carried on the Monobank
 * invoice, the amount requested, and the hosted page to pay on.
 */
export class TournamentDonationIntentDto {
  @ApiProperty({
    description:
      'Unique DON- code carried as the reference on the Monobank invoice.',
  })
  reference: string;

  @ApiProperty({ description: 'Donation amount requested, in kopecks.' })
  amount: number;

  @ApiProperty({
    nullable: true,
    description:
      'Monobank payment page for the invoice, or null when acquiring is not configured.',
  })
  pageUrl: string | null;
}
