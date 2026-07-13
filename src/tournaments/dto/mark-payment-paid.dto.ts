import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkPaymentPaidDto {
  @ApiPropertyOptional({
    description: 'Optional audit note explaining the manual override.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
