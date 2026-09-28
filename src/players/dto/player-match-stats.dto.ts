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
 * playoff maps). A player is credited with a map when the Dota match data
 * lists them (`match_participant`); maps without participant data fall back
 * to the current main roster / captain. Unfinished maps are excluded.
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
