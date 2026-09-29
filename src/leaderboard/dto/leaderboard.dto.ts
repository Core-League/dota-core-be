import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlayerRankDto } from '../../players/dto/player-rank.dto';

/** Podium finishes of one player, counted per decided tournament. */
export class LeaderboardPodiumDto {
  @ApiProperty({ description: 'Tournaments won' })
  first: number;

  @ApiProperty({ description: 'Second places' })
  second: number;

  @ApiProperty({ description: 'Third places' })
  third: number;
}

/**
 * Points each statistic contributes to `score`. Returned with the board so the
 * UI can explain the formula from a single source of truth.
 */
export class LeaderboardWeightsDto {
  @ApiProperty({ description: 'Per tournament won' })
  firstPlace: number;

  @ApiProperty({ description: 'Per second place' })
  secondPlace: number;

  @ApiProperty({ description: 'Per third place' })
  thirdPlace: number;

  @ApiProperty({
    description:
      'Per distinct achievement kind, excluding the three placement kinds (scored above) and the joke trophies',
  })
  achievement: number;

  @ApiProperty({ description: 'Per map won' })
  mapWon: number;

  @ApiProperty({ description: 'Per map played (win or loss)' })
  mapPlayed: number;

  @ApiProperty({ description: 'Per qualification point' })
  tournamentPoint: number;
}

/** One row of the platform leaderboard. */
export class LeaderboardPlayerDto {
  @ApiProperty({ description: '1-based rank on the board' })
  position: number;

  @ApiProperty()
  playerId: string;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Profile confirmed by the administration' })
  verified: boolean;

  @ApiProperty({ description: 'Self-reported MMR; shown, not scored' })
  rating: number;

  @ApiProperty({ type: PlayerRankDto })
  rank: PlayerRankDto;

  @ApiProperty({
    description: 'Composite score — see `weights` on the response',
  })
  score: number;

  @ApiProperty({ description: 'Distinct achievement kinds held' })
  achievements: number;

  @ApiProperty({ type: LeaderboardPodiumDto })
  podium: LeaderboardPodiumDto;

  @ApiProperty({ description: 'Maps with a recorded result, all tournaments' })
  maps: number;

  @ApiProperty()
  wins: number;

  @ApiProperty()
  losses: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Win rate 0–100, rounded; null when no maps were played',
  })
  winrate: number | null;

  @ApiProperty({
    description: 'Distinct tournaments with at least one map played',
  })
  tournaments: number;

  @ApiProperty({ description: 'Lifetime qualification points' })
  tournamentPoints: number;

  @ApiProperty({ description: 'Kills across recorded Dota match lines' })
  kills: number;

  @ApiProperty()
  deaths: number;

  @ApiProperty()
  assists: number;
}

/** Response of GET /leaderboard. */
export class LeaderboardDto {
  @ApiProperty({ description: 'ISO timestamp the board was built at.' })
  generatedAt: string;

  @ApiProperty({ type: LeaderboardWeightsDto })
  weights: LeaderboardWeightsDto;

  @ApiProperty({
    type: LeaderboardPlayerDto,
    isArray: true,
    description:
      'Every player with at least one recorded map or one achievement, best first.',
  })
  players: LeaderboardPlayerDto[];
}
