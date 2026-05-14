import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class OverrideMatchResultDto {
  @ApiProperty({ description: 'UUID of the winning team (must be teamA or teamB)' })
  @IsUUID()
  winnerTeamId: string;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  winnerPoints?: number;

  @ApiPropertyOptional({ default: 40 })
  @IsOptional()
  @IsInt()
  @Min(0)
  loserPoints?: number;
}
