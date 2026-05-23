import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ManualPlayoffSeriesGameDto {
  @ApiProperty({
    description: 'Challonge bracket node id this game belongs to.',
  })
  @IsString()
  @MaxLength(64)
  challongeMatchId: string;

  @ApiProperty({
    description: 'Winning Core team UUID (must appear in this bracket slot)',
  })
  @IsUUID()
  winnerTeamId: string;

  @ApiPropertyOptional({
    description:
      'Optional OpenDota match id — when omitted an internal synthetic id is used.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  dotaMatchId?: string;
}
