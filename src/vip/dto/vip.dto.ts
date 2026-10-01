import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { VIP_ADMIN_GRANT_MAX_MONTHS, VIP_FRAME_COLORS } from '../vip.constants';

/** VIP fields on every public player payload. */
export class PlayerVipFieldsDto {
  @ApiProperty({ description: 'VIP right now (vipUntil in the future)' })
  isVip: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'Null when not VIP',
  })
  vipUntil: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    enum: VIP_FRAME_COLORS,
    description:
      'Card frame colour picked by a VIP; null when not VIP or not set',
  })
  vipFrameColor: string | null;
}

export class VipStatusDto extends PlayerVipFieldsDto {
  @ApiProperty({ description: 'Price of one month, kopecks' })
  priceKopecks: number;

  @ApiProperty({ type: [String], description: 'Frame colours a VIP may pick' })
  frameColors: string[];

  @ApiProperty({
    description:
      'A saved card will be charged automatically at the end of the period',
  })
  autoRenew: boolean;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  nextChargeAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Card on file, e.g. 537541******1234',
  })
  maskedPan: string | null;

  @ApiProperty({
    description: 'A card is saved, so auto-renewal can be switched back on',
  })
  hasSavedCard: boolean;

  @ApiProperty({
    description: 'A first-payment invoice was created and has not settled yet',
  })
  paymentPending: boolean;
}

export class VipCheckoutDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Monobank payment page; null when acquiring is not configured',
  })
  pageUrl: string | null;

  @ApiProperty()
  reference: string;

  @ApiProperty({ description: 'Kopecks' })
  amount: number;
}

export class UpdateVipFrameColorDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    enum: VIP_FRAME_COLORS,
    description: 'null resets to the standard frame',
  })
  @ValidateIf((_, value) => value !== null)
  @IsIn(VIP_FRAME_COLORS as readonly string[])
  color: string | null;
}

export class AdminGrantVipDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: VIP_ADMIN_GRANT_MAX_MONTHS,
    description:
      'Months added on top of the current VIP period (or from now). Required unless `lifetime`.',
  })
  @ValidateIf((dto: AdminGrantVipDto) => !dto.lifetime)
  @IsInt()
  @Min(1)
  @Max(VIP_ADMIN_GRANT_MAX_MONTHS)
  months?: number;

  @ApiPropertyOptional({
    description: 'Lifetime VIP: never expires, auto-renewal is switched off',
  })
  @IsOptional()
  @IsBoolean()
  lifetime?: boolean;
}

export class AdminVipResultDto extends PlayerVipFieldsDto {
  @ApiProperty()
  playerId: string;

  @ApiProperty({ description: 'VIP never expires' })
  lifetime: boolean;
}
