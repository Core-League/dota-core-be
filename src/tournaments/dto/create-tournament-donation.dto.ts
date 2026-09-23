import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/** Smallest donation accepted, in kopecks (10 грн). */
export const MIN_DONATION_KOPECKS = 1000;
/** Largest donation accepted, in kopecks (50 000 грн). */
export const MAX_DONATION_KOPECKS = 5_000_000;

export class CreateTournamentDonationDto {
  @ApiProperty({
    description: 'Donation amount in kopecks, e.g. 10000 for 100 грн.',
    minimum: MIN_DONATION_KOPECKS,
    maximum: MAX_DONATION_KOPECKS,
    example: 10000,
  })
  @IsInt({ message: 'Сума донату має бути цілим числом у копійках' })
  @Min(MIN_DONATION_KOPECKS, { message: 'Мінімальна сума донату — 10 грн' })
  @Max(MAX_DONATION_KOPECKS, {
    message: 'Максимальна сума донату — 50 000 грн',
  })
  amount: number;
}
