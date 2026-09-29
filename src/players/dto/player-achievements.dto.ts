import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Trophy kinds a profile can hold. Placement trophies come from finished
 * playoffs; the "most …" trophies are platform-wide records that every tied
 * leader shares, so they can appear on several profiles at once.
 */
export enum PlayerAchievementKind {
  TOURNAMENT_FIRST_PLACE = 'TOURNAMENT_FIRST_PLACE',
  TOURNAMENT_SECOND_PLACE = 'TOURNAMENT_SECOND_PLACE',
  TOURNAMENT_THIRD_PLACE = 'TOURNAMENT_THIRD_PLACE',
  MOST_MATCHES_PLAYED = 'MOST_MATCHES_PLAYED',
  MOST_MATCHES_WON = 'MOST_MATCHES_WON',
  /** The consolation prize: more recorded losses than anyone else on the platform. */
  MOST_MATCHES_LOST = 'MOST_MATCHES_LOST',
  HIGHEST_RATING = 'HIGHEST_RATING',
}

export class PlayerAchievementTournamentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class PlayerAchievementDto {
  @ApiProperty({
    enum: PlayerAchievementKind,
    enumName: 'PlayerAchievementKind',
  })
  kind: PlayerAchievementKind;

  @ApiProperty({
    description:
      'How many times the trophy was earned: tournaments for placements, 1 for platform records',
  })
  count: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The record value behind a platform trophy (maps played / won / lost, or rating); null for placements',
    example: 42,
  })
  value: number | null;

  @ApiProperty({
    type: PlayerAchievementTournamentDto,
    isArray: true,
    description:
      'Tournaments the placement was earned in; empty for platform records',
  })
  tournaments: PlayerAchievementTournamentDto[];
}

/** Response of GET /players/:id/achievements. `achievements` is empty when nothing was earned. */
export class PlayerAchievementsDto {
  @ApiProperty({ type: PlayerAchievementDto, isArray: true })
  achievements: PlayerAchievementDto[];
}
