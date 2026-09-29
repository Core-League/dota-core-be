import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Trophy kinds a profile can hold, in display order. Placement trophies come
 * from finished playoffs; "MOST_…" / "BEST_…" trophies are platform-wide
 * records every tied leader shares; the rest are personal milestones and
 * feats. All of them are computed on request from our own match records —
 * see `PlayerAchievementsService` for the exact rule behind each one.
 */
export enum PlayerAchievementKind {
  // Podium
  TOURNAMENT_FIRST_PLACE = 'TOURNAMENT_FIRST_PLACE',
  TOURNAMENT_SECOND_PLACE = 'TOURNAMENT_SECOND_PLACE',
  TOURNAMENT_THIRD_PLACE = 'TOURNAMENT_THIRD_PLACE',
  /** Champion whose team won every credited map of that tournament (3+ maps). */
  FLAWLESS_CHAMPION = 'FLAWLESS_CHAMPION',
  /** Champion whose team lost a series in that playoff and still took the final. */
  LOWER_BRACKET_CHAMPION = 'LOWER_BRACKET_CHAMPION',
  /** Every qualification map of a tournament won (3+ maps). */
  PERFECT_QUALIFICATION = 'PERFECT_QUALIFICATION',

  // Platform records
  MOST_MATCHES_PLAYED = 'MOST_MATCHES_PLAYED',
  MOST_MATCHES_WON = 'MOST_MATCHES_WON',
  /** The consolation prize: more recorded losses than anyone else on the platform. */
  MOST_MATCHES_LOST = 'MOST_MATCHES_LOST',
  BEST_WINRATE = 'BEST_WINRATE',
  HIGHEST_RATING = 'HIGHEST_RATING',
  MOST_TOURNAMENT_POINTS = 'MOST_TOURNAMENT_POINTS',
  MOST_KILLS = 'MOST_KILLS',
  MOST_ASSISTS = 'MOST_ASSISTS',
  MOST_DEATHS = 'MOST_DEATHS',

  // Milestones
  FIRST_MATCH = 'FIRST_MATCH',
  MAPS_25 = 'MAPS_25',
  MAPS_100 = 'MAPS_100',
  TOURNAMENTS_5 = 'TOURNAMENTS_5',
  WIN_STREAK_5 = 'WIN_STREAK_5',
  WIN_STREAK_10 = 'WIN_STREAK_10',

  // Combat feats (single-map stats from the Dota match data)
  KILLS_20_IN_MAP = 'KILLS_20_IN_MAP',
  ASSISTS_25_IN_MAP = 'ASSISTS_25_IN_MAP',
  DEATHLESS_WIN = 'DEATHLESS_WIN',

  // Heroes & sides
  HERO_LOYALIST = 'HERO_LOYALIST',
  HERO_COLLECTOR = 'HERO_COLLECTOR',
  RADIANT_CHILD = 'RADIANT_CHILD',
  DIRE_DEVOTEE = 'DIRE_DEVOTEE',

  // Community
  TEAM_CAPTAIN = 'TEAM_CAPTAIN',
  VERIFIED_PLAYER = 'VERIFIED_PLAYER',
  FULLY_CONNECTED = 'FULLY_CONNECTED',
  LAN_READY = 'LAN_READY',
  PATRON = 'PATRON',
  SQUAD_SOCIALITE = 'SQUAD_SOCIALITE',

  // With a wink
  FEEDER_15_DEATHS = 'FEEDER_15_DEATHS',
  LOSS_STREAK_5 = 'LOSS_STREAK_5',
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
      'How many times the trophy was earned: tournaments for placements, maps for per-map feats, 1 otherwise',
  })
  count: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The number behind the trophy (maps, kills, streak length, rating, percent…); null when there is none',
    example: 42,
  })
  value: number | null;

  @ApiProperty({
    type: PlayerAchievementTournamentDto,
    isArray: true,
    description:
      'Tournaments the trophy was earned in; empty for records and personal feats',
  })
  tournaments: PlayerAchievementTournamentDto[];
}

/** Response of GET /players/:id/achievements. `achievements` is empty when nothing was earned. */
export class PlayerAchievementsDto {
  @ApiProperty({ type: PlayerAchievementDto, isArray: true })
  achievements: PlayerAchievementDto[];
}

/** A player holding a trophy on the platform-wide board. */
export class PlatformAchievementHolderDto {
  @ApiProperty()
  playerId: string;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({
    description:
      'Times earned: tournaments for placements, maps for per-map feats, 1 otherwise',
  })
  count: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The number behind the trophy; null when there is none',
  })
  value: number | null;
}

/** One trophy kind with everyone who holds it, best holder first. */
export class PlatformAchievementDto {
  @ApiProperty({
    enum: PlayerAchievementKind,
    enumName: 'PlayerAchievementKind',
  })
  kind: PlayerAchievementKind;

  @ApiProperty({ type: PlatformAchievementHolderDto, isArray: true })
  holders: PlatformAchievementHolderDto[];
}

/** Response of GET /admin/analytics/achievements: every kind, including those nobody holds yet. */
export class PlatformAchievementsDto {
  @ApiProperty({ description: 'ISO timestamp the board was built at.' })
  generatedAt: string;

  @ApiProperty({ type: PlatformAchievementDto, isArray: true })
  achievements: PlatformAchievementDto[];
}
