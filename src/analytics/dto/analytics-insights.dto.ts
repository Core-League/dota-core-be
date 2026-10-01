import { ApiProperty } from '@nestjs/swagger';

export class PositionBucketDto {
  @ApiProperty({ enum: [1, 2, 3, 4, 5], description: 'Dota position 1–5.' })
  position: number;

  @ApiProperty({
    description:
      'Players who listed this position (a player may list several).',
  })
  players: number;

  @ApiProperty({
    description: 'Of them, players without a team — available to recruit.',
  })
  freeAgents: number;
}

export class AnalyticsRosterDto {
  @ApiProperty({
    description: 'Players with a rating above 0 (same filter as the overview).',
  })
  players: number;

  @ApiProperty({
    description: 'Main, reserve or captain of a team that is not disbanded.',
  })
  inTeam: number;

  @ApiProperty({ description: 'Players without a team.' })
  freeAgents: number;

  @ApiProperty({ description: 'Players with a linked Steam account.' })
  steamLinked: number;

  @ApiProperty({ description: 'Players with a linked Telegram account.' })
  telegramLinked: number;

  @ApiProperty({ description: 'Players who picked at least one position.' })
  withPositions: number;

  @ApiProperty({ type: [PositionBucketDto] })
  positions: PositionBucketDto[];
}

export class RevenueMonthDto {
  @ApiProperty({
    example: '2026-09',
    description: 'Calendar month, Europe/Kyiv.',
  })
  month: string;

  @ApiProperty({ description: 'Paid VIP charges, kopecks.' })
  vip: number;

  @ApiProperty({ description: 'Paid tournament entry fees, kopecks.' })
  entryFees: number;

  @ApiProperty({ description: 'Paid tournament donations, kopecks.' })
  donations: number;
}

export class RevenueBySourceDto {
  @ApiProperty({ description: 'Kopecks.' })
  vip: number;

  @ApiProperty({ description: 'Kopecks.' })
  entryFees: number;

  @ApiProperty({ description: 'Kopecks.' })
  donations: number;
}

export class AnalyticsRevenueDto {
  @ApiProperty({
    type: RevenueBySourceDto,
    description: 'All-time paid amounts per source.',
  })
  total: RevenueBySourceDto;

  @ApiProperty({
    type: RevenueBySourceDto,
    description: 'Paid amounts over the last 30 days.',
  })
  last30Days: RevenueBySourceDto;

  @ApiProperty({
    type: [RevenueMonthDto],
    description:
      'Last 6 calendar months, oldest first, current month included; empty months are zeros.',
  })
  monthly: RevenueMonthDto[];
}

export class AnalyticsVipDto {
  @ApiProperty({
    description:
      'Players with `vipUntil` in the future (lifetime grants included).',
  })
  active: number;

  @ApiProperty({ description: 'Of them, lifetime admin grants.' })
  lifetime: number;

  @ApiProperty({ description: 'Active VIPs with auto-renewal switched on.' })
  autoRenew: number;

  @ApiProperty({
    description: 'Non-lifetime VIPs whose period ends within 7 days.',
  })
  expiringSoon: number;
}

export class DuelDayDto {
  @ApiProperty({
    example: '2026-09-30',
    description: 'Calendar day, Europe/Kyiv.',
  })
  date: string;

  @ApiProperty({
    description:
      'Duels created that day which finished with a result (RESOLVED).',
  })
  played: number;

  @ApiProperty({
    description:
      'Duels created that day which ended without a result (CANCELLED or FAILED).',
  })
  notPlayed: number;
}

export class AnalyticsDuelActivityDto {
  @ApiProperty({
    type: [DuelDayDto],
    description: 'Last 30 days, oldest first, today included.',
  })
  daily: DuelDayDto[];

  @ApiProperty({ description: 'FAILED duels waiting for an admin decision.' })
  awaitingReview: number;
}

export class AnalyticsInsightsDto {
  @ApiProperty({ example: '2026-10-01T12:00:00.000Z' })
  generatedAt: string;

  @ApiProperty({ type: AnalyticsRosterDto })
  roster: AnalyticsRosterDto;

  @ApiProperty({ type: AnalyticsRevenueDto })
  revenue: AnalyticsRevenueDto;

  @ApiProperty({ type: AnalyticsVipDto })
  vip: AnalyticsVipDto;

  @ApiProperty({ type: AnalyticsDuelActivityDto })
  duelActivity: AnalyticsDuelActivityDto;
}
