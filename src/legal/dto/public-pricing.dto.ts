import { ApiProperty } from '@nestjs/swagger';

/** VIP subscription price as the checkout charges it. */
export class PublicVipPricingDto {
  @ApiProperty({ example: 20000, description: 'One VIP month, kopecks.' })
  priceKopecks: number;

  @ApiProperty({
    example: 1,
    description: 'Months one payment (and every renewal) buys.',
  })
  periodMonths: number;

  @ApiProperty({
    example: 10,
    description:
      'Loyalty discount, percent, on every month for players who had paid through Monobank before the switch to WayForPay.',
  })
  switchDiscountPercent: number;

  @ApiProperty({
    example: 10,
    description:
      'Discount, percent, on a tournament entry fee when the paying captain is VIP.',
  })
  tournamentDiscountPercent: number;
}

/** Bounds of a voluntary support payment. */
export class PublicSupportPricingDto {
  @ApiProperty({ example: 1000, description: 'Smallest amount, kopecks.' })
  minKopecks: number;

  @ApiProperty({ example: 5000000, description: 'Largest amount, kopecks.' })
  maxKopecks: number;
}

/** A paid tournament whose registration is open or that has not started yet. */
export class PublicTournamentPricingDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    example: 50000,
    description: 'Entry fee per team, kopecks (paid once by the captain).',
  })
  entryFeeKopecks: number;

  @ApiProperty({
    example: 10000,
    description:
      'The entry fee split over a 5-player main roster, kopecks. Informational only.',
  })
  perPlayerKopecks: number;

  @ApiProperty({
    example: 45000,
    description: 'Entry fee a VIP captain pays, kopecks.',
  })
  vipEntryFeeKopecks: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 5000,
    description:
      'Prize pool in hryvnias, fixed by the organiser and announced in advance.',
  })
  prizePool: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When registration closes: the deadline, or an earlier close by an admin.',
  })
  registrationEndsAt: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When play begins: the qualification start when the tournament has one, else the playoff start.',
  })
  startsAt: string | null;
}

/**
 * Everything the public price list shows, computed by the same helpers the
 * checkout uses, so the page and the amount sent to the payment provider can
 * never disagree.
 */
export class PublicPricingDto {
  @ApiProperty({ example: 'UAH' })
  currency: string;

  @ApiProperty({
    example: '2026-10-14',
    description:
      'Current version of the legal documents; payment intents must send it back with consent: true.',
  })
  legalVersion: string;

  @ApiProperty({ type: PublicVipPricingDto })
  vip: PublicVipPricingDto;

  @ApiProperty({ type: PublicSupportPricingDto })
  support: PublicSupportPricingDto;

  @ApiProperty({ type: [PublicTournamentPricingDto] })
  tournaments: PublicTournamentPricingDto[];
}
