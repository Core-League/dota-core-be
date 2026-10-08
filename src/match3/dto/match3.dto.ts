import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray } from 'class-validator';
import { MATCH3_MAX_ACTIONS } from '../match3.engine';

export class Match3RunStartDto {
  @ApiProperty({ description: 'Run id — finish it with this id' })
  id: string;

  @ApiProperty({ description: 'Board seed for the client engine (0…2^31-1)' })
  seed: number;
}

export class FinishMatch3RunDto {
  /**
   * Shapes are checked by the engine during the replay (an unknown or
   * malformed action makes the run invalid), so the items stay plain objects.
   */
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Action log in play order, each with `t` = ms since the round start: ' +
      '`{ type: "swap" | "blink", from: [r, c], to: [r, c], t }`, `{ type: "laguna", row, t }`, ' +
      '`{ type: "refresher", t }`. Times must not run ahead of the server clock.',
  })
  @IsArray()
  @ArrayMaxSize(MATCH3_MAX_ACTIONS)
  actions: Record<string, unknown>[];
}

export class Match3RunResultDto {
  @ApiProperty({ description: 'Score computed by the server replay' })
  score: number;

  @ApiProperty()
  moves: number;

  @ApiProperty()
  bestChain: number;

  @ApiProperty({ description: 'My best score after this run' })
  best: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'My place on the board after this run; null with no score yet',
  })
  position: number | null;

  @ApiProperty({ description: 'This run beat my previous best' })
  isRecord: boolean;
}

export class Match3PlayerDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;
}

export class Match3LeaderboardRowDto {
  @ApiProperty({ description: '1-based place' })
  position: number;

  @ApiProperty({ type: Match3PlayerDto })
  player: Match3PlayerDto;

  @ApiProperty({ description: 'Best score of the player' })
  score: number;

  @ApiProperty({ type: String, format: 'date-time' })
  achievedAt: Date;
}

export class Match3LeaderboardMeDto {
  @ApiProperty()
  best: number;

  @ApiProperty()
  position: number;
}

export class Match3LeaderboardDto {
  @ApiProperty({ type: [Match3LeaderboardRowDto], description: 'Top 10' })
  rows: Match3LeaderboardRowDto[];

  @ApiProperty({ description: 'Players with at least one scored run' })
  totalPlayers: number;

  @ApiPropertyOptional({
    type: Match3LeaderboardMeDto,
    nullable: true,
    description: 'The viewer, when logged in and on the board',
  })
  me: Match3LeaderboardMeDto | null;
}
