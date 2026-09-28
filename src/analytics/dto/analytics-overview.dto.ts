import { ApiProperty } from '@nestjs/swagger';
import { TournamentStatus } from '../../tournaments/tournaments.model';
import { SocialChannel, type SocialFollowersSource } from '../analytics.model';

export class SocialChannelStatDto {
  @ApiProperty({ enum: SocialChannel })
  channel: SocialChannel;

  @ApiProperty({ example: 'Telegram' })
  label: string;

  @ApiProperty({ example: 'https://t.me/core_league_lviv' })
  url: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Best known follower count: live when available, else manual, else null.',
  })
  followers: number | null;

  @ApiProperty({ enum: ['live', 'manual', 'unavailable'] })
  source: SocialFollowersSource;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'ISO timestamp of the live fetch or the manual edit that produced `followers`.',
  })
  fetchedAt: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Admin-entered value, if any.',
  })
  manualFollowers: number | null;

  @ApiProperty({ type: String, nullable: true })
  manualUpdatedAt: string | null;
}

export class AnalyticsTotalsDto {
  @ApiProperty()
  players: number;

  @ApiProperty({ description: 'Players with `verifiedAt` set.' })
  verifiedPlayers: number;

  @ApiProperty({ description: 'Teams that are not disbanded.' })
  teams: number;

  @ApiProperty()
  verifiedTeams: number;

  @ApiProperty()
  tournaments: number;

  @ApiProperty({ description: 'Tournaments not yet COMPLETED.' })
  activeTournaments: number;
}

export class RankBucketDto {
  @ApiProperty({ description: '1 (Герольд) … 8 (Титан)' })
  rankNumber: number;

  @ApiProperty({ example: 'Легенда' })
  nameUk: string;

  @ApiProperty()
  players: number;
}

export class TeamsVerificationDto {
  @ApiProperty()
  verified: number;

  @ApiProperty()
  unverified: number;
}

export class TournamentParticipantsDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: TournamentStatus })
  status: TournamentStatus;

  @ApiProperty({ description: 'Teams registered in the tournament.' })
  teams: number;

  @ApiProperty({ type: Number, nullable: true })
  slots: number | null;

  @ApiProperty({ description: 'ISO date of the playoff start (sort key).' })
  startsAt: string;
}

export class WantToPlayDto {
  @ApiProperty({ description: 'Players who picked only ONLINE.' })
  onlineOnly: number;

  @ApiProperty({ description: 'Players who picked only LAN.' })
  lanOnly: number;

  @ApiProperty({ description: 'Players who picked both formats.' })
  both: number;

  @ApiProperty({
    description: 'Players who explicitly picked no format (empty list).',
  })
  none: number;

  @ApiProperty({ description: 'Players who never answered (null).' })
  unset: number;

  @ApiProperty({
    description:
      'onlineOnly + both — everyone interested in online tournaments.',
  })
  online: number;

  @ApiProperty({ description: 'lanOnly + both.' })
  lan: number;
}

export class CityBucketDto {
  @ApiProperty({ example: 'Львів' })
  city: string;

  @ApiProperty()
  players: number;
}

export class AnalyticsOverviewDto {
  @ApiProperty({ description: 'ISO timestamp the overview was built at.' })
  generatedAt: string;

  @ApiProperty({ type: [SocialChannelStatDto] })
  socials: SocialChannelStatDto[];

  @ApiProperty({ type: AnalyticsTotalsDto })
  totals: AnalyticsTotalsDto;

  @ApiProperty({
    type: [RankBucketDto],
    description: 'Always 8 buckets, rank 1 → 8.',
  })
  ranks: RankBucketDto[];

  @ApiProperty({ type: TeamsVerificationDto })
  teams: TeamsVerificationDto;

  @ApiProperty({
    type: [TournamentParticipantsDto],
    description: 'Newest first.',
  })
  tournaments: TournamentParticipantsDto[];

  @ApiProperty({ type: WantToPlayDto })
  wantToPlay: WantToPlayDto;

  @ApiProperty({
    type: [CityBucketDto],
    description: 'Sorted by players, descending.',
  })
  cities: CityBucketDto[];
}
