import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlayerMatchStageStatsDto {
  @ApiProperty({ description: 'Matches with a recorded result' })
  total: number;

  @ApiProperty()
  wins: number;

  @ApiProperty()
  losses: number;
}

/**
 * Per-player record across this platform's tournaments (qualification +
 * playoff maps), from our own results only. A player is credited with every
 * map their team (current main roster / captain) has a recorded winner for,
 * including manual entries and tech losses. Unfinished maps are excluded.
 */
export class PlayerMatchStatsDto {
  @ApiProperty({ description: 'Maps played across all tournaments' })
  total: number;

  @ApiProperty()
  wins: number;

  @ApiProperty()
  losses: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Win rate 0–100, rounded; null when no maps were played',
    example: 57,
  })
  winrate: number | null;

  @ApiProperty({
    description: 'Distinct tournaments with at least one map played',
  })
  tournaments: number;

  @ApiProperty({ type: PlayerMatchStageStatsDto })
  qualification: PlayerMatchStageStatsDto;

  @ApiProperty({ type: PlayerMatchStageStatsDto })
  playoff: PlayerMatchStageStatsDto;
}
