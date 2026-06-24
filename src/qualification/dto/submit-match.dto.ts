import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumberString, IsOptional } from 'class-validator';

export class SubmitMatchDto {
  @ApiProperty({ description: 'Dota2 numeric match ID from the played game' })
  @IsNumberString()
  dotaMatchId: string;

  @ApiPropertyOptional({
    description:
      'Admin-only: skip OpenDota match validation (10 players / duration / end-time / team-ID / roster checks). Ignored for non-admins. The match is still fetched so the winner and awarded points are derived from real data.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  skipMatchValidation?: boolean;
}
