import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus } from '../tournament-team-payment.model';

export class TournamentPaymentSummaryDto {
  @ApiProperty({ format: 'uuid' })
  teamId: string;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status: PaymentStatus;

  @ApiProperty({ description: 'Amount paid so far, in kopecks.' })
  amountPaid: number;
}
