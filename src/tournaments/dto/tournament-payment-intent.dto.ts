import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus } from '../tournament-team-payment.model';

/**
 * A captain-scoped payment intent: the reference to put in the Monobank jar
 * comment, the amount owed, and the jar URL to open. Returned by the create-intent
 * and status endpoints so the frontend can redirect and poll.
 */
export class TournamentPaymentIntentDto {
  @ApiProperty({ description: 'Unique code to include in the jar comment.' })
  reference: string;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status: PaymentStatus;

  @ApiProperty({ description: 'Entry fee owed, in kopecks.' })
  amount: number;

  @ApiProperty({ description: 'Amount paid so far, in kopecks.' })
  amountPaid: number;

  @ApiProperty({
    nullable: true,
    description:
      'Prefilled Monobank jar URL, or null when the jar is not configured.',
  })
  jarUrl: string | null;
}
