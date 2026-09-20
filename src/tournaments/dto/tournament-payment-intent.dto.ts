import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus } from '../tournament-team-payment.model';

/**
 * A captain-scoped payment intent: the reference carried on the Monobank
 * invoice, the amount owed, and the hosted page to pay on. Returned by the
 * create-intent and status endpoints so the frontend can redirect and poll.
 */
export class TournamentPaymentIntentDto {
  @ApiProperty({
    description:
      'Unique code carried as the reference on the Monobank invoice.',
  })
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
      'Monobank payment page for the open invoice, or null when there is none to pay.',
  })
  pageUrl: string | null;
}
