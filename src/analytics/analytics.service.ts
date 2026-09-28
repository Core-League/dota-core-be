import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { Player, TournamentFormat } from '../players/player.entity';
import {
  UK_NAMES,
  resolvePlayerRankFromNumericRating,
} from '../players/rank-system';
import { Team } from '../teams/team.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { TournamentStatus } from '../tournaments/tournaments.model';
import {
  SOCIAL_CHANNELS,
  SOCIAL_CHANNEL_CATALOG,
  SocialChannel,
} from './analytics.model';
import {
  AnalyticsOverviewDto,
  AnalyticsTotalsDto,
  CityBucketDto,
  RankBucketDto,
  SocialChannelStatDto,
  TeamsVerificationDto,
  TournamentParticipantsDto,
  WantToPlayDto,
} from './dto/analytics-overview.dto';
import { SocialChannelStat } from './social-channel-stat.entity';
import { SocialFollowersService } from './social-followers.service';

const RANK_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

type PlayerSlice = Pick<
  Player,
  'rating' | 'city' | 'wantToPlay' | 'verifiedAt'
>;

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SocialChannelStat)
    private readonly socialRepo: Repository<SocialChannelStat>,
    private readonly socialFollowers: SocialFollowersService,
  ) {}

  async getOverview(): Promise<AnalyticsOverviewDto> {
    const [players, teams, tournaments, socials] = await Promise.all([
      this.loadPlayers(),
      this.loadTeams(),
      this.loadTournaments(),
      this.loadSocials(),
    ]);

    const totals: AnalyticsTotalsDto = {
      players: players.length,
      verifiedPlayers: players.filter((p) => p.verifiedAt != null).length,
      teams: teams.verified + teams.unverified,
      verifiedTeams: teams.verified,
      tournaments: tournaments.length,
      activeTournaments: tournaments.filter(
        (t) => t.status !== TournamentStatus.COMPLETED,
      ).length,
    };

    return {
      generatedAt: new Date().toISOString(),
      socials,
      totals,
      ranks: this.bucketRanks(players),
      teams,
      tournaments,
      wantToPlay: this.bucketWantToPlay(players),
      cities: this.bucketCities(players),
    };
  }

  async setManualFollowers(
    channel: SocialChannel,
    followers: number | null,
  ): Promise<SocialChannelStatDto> {
    await this.socialRepo.save(this.socialRepo.create({ channel, followers }));
    const row = await this.socialRepo.findOneBy({ channel });
    return this.buildSocialStat(channel, row);
  }

  // ─── Loaders ───────────────────────────────────────────────────────────────

  /**
   * Players with a rating of 0 never set their MMR (fresh accounts), so they are
   * left out of every player-based number: totals, ranks, wantToPlay and cities.
   */
  private loadPlayers(): Promise<PlayerSlice[]> {
    return this.dataSource.getRepository(Player).find({
      select: ['id', 'rating', 'city', 'wantToPlay', 'verifiedAt'],
      where: { rating: MoreThan(0) },
    });
  }

  private async loadTeams(): Promise<TeamsVerificationDto> {
    const rows = await this.dataSource
      .getRepository(Team)
      .createQueryBuilder('t')
      .select('t.isVerified', 'isVerified')
      .addSelect('COUNT(*)', 'count')
      .where('t.disbandedAt IS NULL')
      .groupBy('t.isVerified')
      .getRawMany<{ isVerified: boolean; count: string }>();

    const result: TeamsVerificationDto = { verified: 0, unverified: 0 };
    for (const row of rows) {
      if (row.isVerified) result.verified += Number(row.count);
      else result.unverified += Number(row.count);
    }
    return result;
  }

  private async loadTournaments(): Promise<TournamentParticipantsDto[]> {
    const rows = await this.dataSource
      .getRepository(Tournament)
      .createQueryBuilder('t')
      .leftJoin('t.teams', 'team')
      .select('t.id', 'id')
      .addSelect('t.name', 'name')
      .addSelect('t.tournamentStatus', 'status')
      .addSelect('t.tournamentSlots', 'slots')
      .addSelect('t.tournamentStartsAt', 'startsAt')
      .addSelect('COUNT(team.id)', 'teams')
      .groupBy('t.id')
      .orderBy('t.tournamentStartsAt', 'DESC')
      .getRawMany<{
        id: string;
        name: string;
        status: TournamentStatus;
        slots: number | null;
        startsAt: Date;
        teams: string;
      }>();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      teams: Number(row.teams),
      slots: row.slots == null ? null : Number(row.slots),
      startsAt: new Date(row.startsAt).toISOString(),
    }));
  }

  private async loadSocials(): Promise<SocialChannelStatDto[]> {
    const manualRows = await this.socialRepo.find();
    const manualByChannel = new Map(manualRows.map((r) => [r.channel, r]));
    return Promise.all(
      SOCIAL_CHANNELS.map((channel) =>
        this.buildSocialStat(channel, manualByChannel.get(channel) ?? null),
      ),
    );
  }

  private async buildSocialStat(
    channel: SocialChannel,
    manual: SocialChannelStat | null,
  ): Promise<SocialChannelStatDto> {
    const def = SOCIAL_CHANNEL_CATALOG[channel];
    const live = await this.socialFollowers.getLive(channel);
    const manualFollowers = manual?.followers ?? null;
    const manualUpdatedAt = manual?.updatedAt?.toISOString() ?? null;
    const base = {
      channel,
      label: def.label,
      url: def.url,
      manualFollowers,
      manualUpdatedAt,
    };

    if (live) {
      return {
        ...base,
        followers: live.followers,
        source: 'live',
        fetchedAt: live.fetchedAt.toISOString(),
      };
    }
    if (manualFollowers != null) {
      return {
        ...base,
        followers: manualFollowers,
        source: 'manual',
        fetchedAt: manualUpdatedAt,
      };
    }
    return { ...base, followers: null, source: 'unavailable', fetchedAt: null };
  }

  // ─── Aggregations ──────────────────────────────────────────────────────────

  private bucketRanks(players: PlayerSlice[]): RankBucketDto[] {
    const counts = new Map<number, number>(RANK_NUMBERS.map((n) => [n, 0]));
    for (const p of players) {
      const { rankNumber } = resolvePlayerRankFromNumericRating(p.rating ?? 0);
      counts.set(rankNumber, (counts.get(rankNumber) ?? 0) + 1);
    }
    return RANK_NUMBERS.map((rankNumber) => ({
      rankNumber,
      nameUk: UK_NAMES[rankNumber] ?? String(rankNumber),
      players: counts.get(rankNumber) ?? 0,
    }));
  }

  private bucketWantToPlay(players: PlayerSlice[]): WantToPlayDto {
    const result: WantToPlayDto = {
      onlineOnly: 0,
      lanOnly: 0,
      both: 0,
      none: 0,
      unset: 0,
      online: 0,
      lan: 0,
    };
    for (const p of players) {
      const formats = p.wantToPlay;
      if (formats == null) {
        result.unset += 1;
        continue;
      }
      const online = formats.includes(TournamentFormat.ONLINE);
      const lan = formats.includes(TournamentFormat.LAN);
      if (online && lan) result.both += 1;
      else if (online) result.onlineOnly += 1;
      else if (lan) result.lanOnly += 1;
      else result.none += 1;
    }
    result.online = result.onlineOnly + result.both;
    result.lan = result.lanOnly + result.both;
    return result;
  }

  private bucketCities(players: PlayerSlice[]): CityBucketDto[] {
    const counts = new Map<string, number>();
    for (const p of players) {
      const city = p.city?.trim();
      if (!city) continue;
      counts.set(city, (counts.get(city) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([city, count]) => ({ city, players: count }))
      .sort(
        (a, b) => b.players - a.players || a.city.localeCompare(b.city, 'uk'),
      );
  }
}
