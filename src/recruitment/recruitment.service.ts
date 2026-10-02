import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  IsNull,
  LessThan,
  MoreThan,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  NotificationStatus,
  NotificationType,
  type NotificationTeam,
} from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { Player, type PlayerPosition } from '../players/player.entity';
import { toPlayerRankDto } from '../players/dto/player-rank.dto';
import { PlayerResponseDto } from '../players/dto/player-response.dto';
import { RANK_TO_STAR_MINS } from '../players/rank-system/tier-thresholds.build';
import { Team } from '../teams/team.entity';
import { TeamsService } from '../teams/teams.service';
import { computeTeamAvgRating } from '../teams/team-rating.util';
import { Role, getRoleColorByName } from '../user-roles/role.constants';
import { isVipActive, toVipPublicFields } from '../vip/vip.utils';
import {
  APPLICATION_TTL_MS,
  DAILY_APPLICATION_LIMIT,
  DAILY_INVITE_LIMIT,
  DAILY_LIMIT_WINDOW_MS,
  INVITE_TTL_MS,
  JoinRequestKind,
  JoinRequestStatus,
  MAIN_ROSTER_SIZE,
  RECRUITMENT_BLOCK_MESSAGES,
  RECRUITMENT_PAGE_SIZE_DEFAULT,
  RESERVE_ROSTER_SIZE,
  RecruitmentBlockReason,
  TeamPostStatus,
  type TeamMemberSlot,
} from './recruitment.constants';
import { PlayerRecruitmentPost } from './player-recruitment-post.entity';
import { TeamJoinRequest } from './team-join-request.entity';
import { TeamRecruitmentPost } from './team-recruitment-post.entity';
import {
  AcceptJoinRequestDto,
  ApplyToTeamPostDto,
  CreateTeamInviteRequestDto,
  CreateTeamPostDto,
  JoinRequestBriefDto,
  JoinRequestDto,
  ManagedTeamDto,
  PlayerListingDto,
  PlayerListingsPageDto,
  PlayerListingsQueryDto,
  RecruitmentMeDto,
  RecruitmentTeamDto,
  TeamPostDto,
  TeamPostsPageDto,
  TeamPostsQueryDto,
  UpdateTeamPostDto,
  UpsertPlayerListingDto,
} from './dto/recruitment.dto';

const TEAM_RELATIONS = ['captain', 'coach', 'mainPlayers', 'reservedPlayers'];
const TEAM_DETAIL_RELATIONS = [
  'captain',
  'captain.roles',
  'coach',
  'coach.roles',
  'mainPlayers',
  'mainPlayers.roles',
  'reservedPlayers',
  'reservedPlayers.roles',
];

const APPLICATION_TYPES = [NotificationType.TEAM_APPLICATION];
const INVITE_TYPES = [NotificationType.TEAM_INVITE];
const REQUEST_TYPES = [...APPLICATION_TYPES, ...INVITE_TYPES];

/** Accepting needs a verified, Steam-linked, team-less player (positions only matter for applying). */
const JOIN_BLOCKS = [
  RecruitmentBlockReason.NOT_VERIFIED,
  RecruitmentBlockReason.NO_STEAM,
  RecruitmentBlockReason.HAS_TEAM,
];

/**
 * Roles that count as verified without `verifiedAt` — the same rule as the
 * frontend's `isPlayerVerified` (staff and streamers need no player verification).
 */
const VERIFIED_ROLE_NAMES: readonly string[] = [
  Role.PLAYER,
  Role.MEDIA,
  Role.ADMIN,
  Role.IT,
];

interface IActor {
  player: Player;
  isAdmin: boolean;
}

const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, (c) => `\\${c}`);

const isUniqueViolation = (e: unknown): boolean =>
  e instanceof QueryFailedError &&
  (e.driverError as { code?: string } | undefined)?.code === '23505';

/** Rating range [lo, hi) of a medal tier 1–8. */
const tierRange = (tier: number): [number, number | null] => {
  const lo = RANK_TO_STAR_MINS[tier]?.[0] ?? 0;
  const hi = RANK_TO_STAR_MINS[tier + 1]?.[0] ?? null;
  return [lo, hi];
};

/** Collects positional SQL parameters (`$1`, `$2`, …). */
class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * "Пошук команди / гравця": team posts players apply to, player listings
 * managers invite from, and the applications / invites between them.
 * Managers = captain, coach, or an admin (for any team).
 */
@Injectable()
export class RecruitmentService {
  private readonly logger = new Logger(RecruitmentService.name);

  constructor(
    @InjectRepository(TeamRecruitmentPost)
    private readonly posts: Repository<TeamRecruitmentPost>,
    @InjectRepository(PlayerRecruitmentPost)
    private readonly listings: Repository<PlayerRecruitmentPost>,
    @InjectRepository(TeamJoinRequest)
    private readonly requests: Repository<TeamJoinRequest>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly teamsService: TeamsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── rules ────────────────────────────────────────────────────────────────

  /** `verifiedAt`, or a role that implies it (needs `player.roles` loaded). */
  static isVerified(player: Player): boolean {
    if (player.verifiedAt) return true;
    return (player.roles ?? []).some((r) =>
      VERIFIED_ROLE_NAMES.includes(r.name),
    );
  }

  /** Profile requirements shared by applying and publishing a listing. */
  static playerBlocks(player: Player): RecruitmentBlockReason[] {
    const out: RecruitmentBlockReason[] = [];
    if (!RecruitmentService.isVerified(player)) {
      out.push(RecruitmentBlockReason.NOT_VERIFIED);
    }
    if (!player.steamId) out.push(RecruitmentBlockReason.NO_STEAM);
    if (player.teamId) out.push(RecruitmentBlockReason.HAS_TEAM);
    if (!player.positions?.length) {
      out.push(RecruitmentBlockReason.NO_POSITIONS);
    }
    return out;
  }

  static matchingPositions(
    player: Player,
    post: Pick<TeamRecruitmentPost, 'positions'>,
  ): PlayerPosition[] {
    return (player.positions ?? []).filter((p) => post.positions.includes(p));
  }

  static postBlocks(
    player: Player,
    post: Pick<TeamRecruitmentPost, 'positions' | 'mmrMin' | 'mmrMax'>,
  ): RecruitmentBlockReason[] {
    const out = RecruitmentService.playerBlocks(player);
    const rating = player.rating ?? 0;
    if (post.mmrMin !== null && rating < post.mmrMin) {
      out.push(RecruitmentBlockReason.MMR_TOO_LOW);
    }
    if (post.mmrMax !== null && rating > post.mmrMax) {
      out.push(RecruitmentBlockReason.MMR_TOO_HIGH);
    }
    if (
      player.positions?.length &&
      !RecruitmentService.matchingPositions(player, post).length
    ) {
      out.push(RecruitmentBlockReason.POSITION_MISMATCH);
    }
    return out;
  }

  private static throwBlocked(reasons: RecruitmentBlockReason[]): void {
    const first = reasons[0];
    if (!first) return;
    throw new BadRequestException({
      error: first,
      message: RECRUITMENT_BLOCK_MESSAGES[first],
    });
  }

  private static isManager(team: Team, playerId: string): boolean {
    return team.captain?.id === playerId || team.coach?.id === playerId;
  }

  private static managerIds(team: Team): string[] {
    return [
      ...new Set([team.captain?.id, team.coach?.id].filter(Boolean)),
    ] as string[];
  }

  private static assertManager(team: Team, actor: IActor): void {
    if (actor.isAdmin || RecruitmentService.isManager(team, actor.player.id)) {
      return;
    }
    throw new ForbiddenException({
      error: 'not_team_manager',
      message: 'Це може зробити лише капітан, тренер команди або адмін',
    });
  }

  /** Throws when the slot is full or locked by a running tournament. */
  private static assertSlotOpen(team: Team, slot: TeamMemberSlot): void {
    if (slot === 'main') {
      if (team.isPlayingTournament) {
        throw new BadRequestException({
          error: 'main_roster_locked',
          message:
            'Команда грає турнір — основний склад змінювати не можна (доступні запасні та тренер)',
        });
      }
      if ((team.mainPlayers ?? []).length >= MAIN_ROSTER_SIZE) {
        throw new BadRequestException({
          error: 'main_roster_full',
          message: 'Основний склад уже заповнений',
        });
      }
      return;
    }
    if (slot === 'reserved') {
      if ((team.reservedPlayers ?? []).length >= RESERVE_ROSTER_SIZE) {
        throw new BadRequestException({
          error: 'reserve_roster_full',
          message: 'Запасний склад уже заповнений',
        });
      }
      return;
    }
    if (team.coach) {
      throw new BadRequestException({
        error: 'coach_taken',
        message: 'У команді вже є тренер',
      });
    }
  }

  /** Bell quick-accept: main if free and not tournament-locked, else reserved. */
  private static autoSlot(team: Team): TeamMemberSlot {
    if (
      !team.isPlayingTournament &&
      (team.mainPlayers ?? []).length < MAIN_ROSTER_SIZE
    ) {
      return 'main';
    }
    if ((team.reservedPlayers ?? []).length < RESERVE_ROSTER_SIZE) {
      return 'reserved';
    }
    throw new BadRequestException({
      error: 'roster_full',
      message: 'У команді немає вільних місць',
    });
  }

  private static validatePostShape(post: {
    mmrMin: number | null;
    mmrMax: number | null;
  }): void {
    if (post.mmrMin === null && post.mmrMax === null) {
      throw new BadRequestException({
        error: 'mmr_range_required',
        message: 'Вкажіть мінімальний або максимальний MMR',
      });
    }
    if (
      post.mmrMin !== null &&
      post.mmrMax !== null &&
      post.mmrMin > post.mmrMax
    ) {
      throw new BadRequestException({
        error: 'mmr_range_invalid',
        message: 'Мінімальний MMR не може бути більшим за максимальний',
      });
    }
  }

  // ── loading ──────────────────────────────────────────────────────────────

  private async loadActor(playerId: string): Promise<IActor> {
    const player = await this.players.findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    if (!player) {
      throw new NotFoundException({
        error: 'player_not_found',
        message: 'Гравця не знайдено',
      });
    }
    return {
      player,
      isAdmin: (player.roles ?? []).some((r) => r.isAdminRole),
    };
  }

  private async loadTeam(teamId: string): Promise<Team> {
    const team = await this.teams.findOne({
      where: { id: teamId, disbandedAt: IsNull() },
      relations: TEAM_RELATIONS,
    });
    if (!team) {
      throw new NotFoundException({
        error: 'team_not_found',
        message: 'Команду не знайдено',
      });
    }
    return team;
  }

  private managedTeamsOf(playerId: string): Promise<Team[]> {
    return this.teams.find({
      where: [
        { captain: { id: playerId }, disbandedAt: IsNull() },
        { coach: { id: playerId }, disbandedAt: IsNull() },
      ],
      relations: TEAM_RELATIONS,
    });
  }

  private async findPost(id: string): Promise<TeamRecruitmentPost> {
    const post = await this.posts.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException({
        error: 'post_not_found',
        message: 'Оголошення не знайдено',
      });
    }
    return post;
  }

  private static assertPostOpen(post: TeamRecruitmentPost): void {
    if (post.status !== TeamPostStatus.OPEN) {
      throw new GoneException({
        error: 'post_closed',
        message: 'Оголошення вже закрите',
      });
    }
  }

  private async findRequest(id: string): Promise<TeamJoinRequest> {
    const row = await this.requests.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException({
        error: 'request_not_found',
        message: 'Запит не знайдено',
      });
    }
    return row;
  }

  /** PENDING and not past its deadline (an overdue one is expired on the spot). */
  private async assertPending(row: TeamJoinRequest): Promise<void> {
    if (row.status !== JoinRequestStatus.PENDING) {
      throw new ConflictException({
        error: 'request_not_pending',
        message: 'Запит уже не чекає на відповідь',
      });
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.finishRequests([row], JoinRequestStatus.EXPIRED);
      throw new GoneException({
        error: 'request_expired',
        message: 'Термін дії запиту минув',
      });
    }
  }

  private countApplicationsToday(playerId: string): Promise<number> {
    return this.requests.count({
      where: {
        kind: JoinRequestKind.APPLICATION,
        createdById: playerId,
        createdAt: MoreThan(new Date(Date.now() - DAILY_LIMIT_WINDOW_MS)),
      },
    });
  }

  private countInvitesToday(teamId: string): Promise<number> {
    return this.requests.count({
      where: {
        kind: JoinRequestKind.INVITE,
        teamId,
        createdAt: MoreThan(new Date(Date.now() - DAILY_LIMIT_WINDOW_MS)),
      },
    });
  }

  // ── mapping ──────────────────────────────────────────────────────────────

  private static teamCard(team: Team): NotificationTeam {
    return { id: team.id, name: team.name, logoUrl: team.logoUrl ?? null };
  }

  private static toTeamDto(team: Team): RecruitmentTeamDto {
    const avg = computeTeamAvgRating(team.mainPlayers ?? []);
    return {
      id: team.id,
      name: team.name,
      logoUrl: team.logoUrl ?? null,
      isVerified: team.isVerified,
      isPlayingTournament: team.isPlayingTournament,
      avgRating: avg === null ? null : Math.round(avg),
      isVip: isVipActive(team.captain),
      captainId: team.captain?.id ?? null,
      coachId: team.coach?.id ?? null,
      mainCount: (team.mainPlayers ?? []).length,
      reservedCount: (team.reservedPlayers ?? []).length,
    };
  }

  private static toBriefDto(row: TeamJoinRequest): JoinRequestBriefDto {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  private static toPlayerDto(player: Player): PlayerResponseDto {
    const rating = player.rating ?? 0;
    return {
      id: player.id,
      steamId: player.steamId ?? null,
      discordId: player.discordId ?? null,
      telegramId: player.telegramId ?? null,
      avatarUrl: player.avatarUrl ?? null,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      rating,
      rank: toPlayerRankDto(rating),
      positions: player.positions ?? null,
      countryCode: player.countryCode ?? null,
      city: player.city ?? null,
      wantToPlay: player.wantToPlay ?? null,
      lanCities: player.lanCities ?? null,
      verifiedAt: player.verifiedAt ?? null,
      ...toVipPublicFields(player),
      teamId: player.teamId ?? null,
      roles: (player.roles ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        isAdminRole: r.isAdminRole,
        color: getRoleColorByName(r.name) ?? '#64748B',
      })),
    };
  }

  /** Posts (with `team` + roster loaded) → DTOs from the actor's point of view. */
  private async toPostDtos(
    posts: TeamRecruitmentPost[],
    actor: IActor,
  ): Promise<TeamPostDto[]> {
    if (!posts.length) return [];
    const pending = await this.requests.find({
      where: {
        kind: JoinRequestKind.APPLICATION,
        playerId: actor.player.id,
        status: JoinRequestStatus.PENDING,
        teamId: In(posts.map((p) => p.teamId)),
      },
    });
    const byTeam = new Map(pending.map((r) => [r.teamId, r]));
    return posts.map((post) => {
      const mine = byTeam.get(post.teamId);
      return {
        id: post.id,
        team: RecruitmentService.toTeamDto(post.team),
        description: post.description ?? null,
        positions: post.positions,
        playersNeeded: post.playersNeeded,
        mmrMin: post.mmrMin ?? null,
        mmrMax: post.mmrMax ?? null,
        formats: post.formats ?? [],
        status: post.status,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        myApplication: mine ? RecruitmentService.toBriefDto(mine) : null,
        blockReasons: RecruitmentService.postBlocks(actor.player, post),
        canManage:
          actor.isAdmin ||
          RecruitmentService.isManager(post.team, actor.player.id),
      };
    });
  }

  private async loadPostsWithTeams(
    ids: string[],
  ): Promise<TeamRecruitmentPost[]> {
    if (!ids.length) return [];
    const rows = await this.posts.find({
      where: { id: In(ids) },
      relations: TEAM_RELATIONS.map((r) => `team.${r}`).concat('team'),
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is TeamRecruitmentPost => !!p);
  }

  private async toPostDto(postId: string, actor: IActor): Promise<TeamPostDto> {
    const [post] = await this.loadPostsWithTeams([postId]);
    if (!post) {
      throw new NotFoundException({
        error: 'post_not_found',
        message: 'Оголошення не знайдено',
      });
    }
    const [dto] = await this.toPostDtos([post], actor);
    return dto;
  }

  /** Listings (with `player.roles` loaded) → DTOs; `myTeamInvite` for teams the actor manages. */
  private async toListingDtos(
    rows: PlayerRecruitmentPost[],
    actor: IActor,
  ): Promise<PlayerListingDto[]> {
    if (!rows.length) return [];
    const managed = await this.managedTeamsOf(actor.player.id);
    const invites = managed.length
      ? await this.requests.find({
          where: {
            kind: JoinRequestKind.INVITE,
            status: JoinRequestStatus.PENDING,
            teamId: In(managed.map((t) => t.id)),
            playerId: In(rows.map((r) => r.playerId)),
          },
        })
      : [];
    const byPlayer = new Map(invites.map((r) => [r.playerId, r]));
    return rows.map((row) => {
      const invite = byPlayer.get(row.playerId);
      return {
        id: row.id,
        description: row.description ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        player: RecruitmentService.toPlayerDto(row.player),
        myTeamInvite: invite ? RecruitmentService.toBriefDto(invite) : null,
      };
    });
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async me(playerId: string): Promise<RecruitmentMeDto> {
    const actor = await this.loadActor(playerId);
    const vip = isVipActive(actor.player);

    const listingRow = await this.listings.findOne({
      where: { playerId },
      relations: ['player', 'player.roles'],
    });
    const [listing] = listingRow
      ? await this.toListingDtos([listingRow], actor)
      : [null];

    const applicationsLeft = vip
      ? null
      : Math.max(
          0,
          DAILY_APPLICATION_LIMIT -
            (await this.countApplicationsToday(playerId)),
        );

    const teams = await this.managedTeamsOf(playerId);
    const managedTeams: ManagedTeamDto[] = [];
    for (const team of teams) {
      const open = await this.posts.findOne({
        where: { teamId: team.id, status: TeamPostStatus.OPEN },
      });
      managedTeams.push({
        team: RecruitmentService.toTeamDto(team),
        post: open ? await this.toPostDto(open.id, actor) : null,
        invitesLeft:
          vip || actor.isAdmin
            ? null
            : Math.max(
                0,
                DAILY_INVITE_LIMIT - (await this.countInvitesToday(team.id)),
              ),
      });
    }

    return {
      isAdmin: actor.isAdmin,
      listing: listing ?? null,
      listingBlockReasons: RecruitmentService.playerBlocks(actor.player),
      applicationsLeft,
      managedTeams,
    };
  }

  async listTeamPosts(
    playerId: string,
    query: TeamPostsQueryDto,
  ): Promise<TeamPostsPageDto> {
    const actor = await this.loadActor(playerId);
    const sql = new SqlParams();
    const where = [`p."status" = 'OPEN'`, `t."disbandedAt" IS NULL`];

    const search = query.search?.trim();
    if (search) {
      where.push(`t."name" ILIKE ${sql.add(`%${escapeLike(search)}%`)}`);
    }
    if (query.positions?.length) {
      where.push(`p."positions" && ${sql.add(query.positions)}::smallint[]`);
    }
    if (query.mmr !== undefined) {
      const mmr = sql.add(query.mmr);
      where.push(
        `(p."mmrMin" IS NULL OR p."mmrMin" <= ${mmr})`,
        `(p."mmrMax" IS NULL OR p."mmrMax" >= ${mmr})`,
      );
    }
    if (query.verified) where.push(`t."isVerified" = true`);
    if (query.formats?.length) {
      where.push(
        `(cardinality(p."formats") = 0 OR p."formats" && ${sql.add(query.formats)}::varchar[])`,
      );
    }
    if (query.eligible) {
      if (RecruitmentService.playerBlocks(actor.player).length) {
        return { items: [], total: 0 };
      }
      const rating = sql.add(actor.player.rating ?? 0);
      where.push(
        `(p."mmrMin" IS NULL OR p."mmrMin" <= ${rating})`,
        `(p."mmrMax" IS NULL OR p."mmrMax" >= ${rating})`,
        `p."positions" && ${sql.add(actor.player.positions)}::smallint[]`,
      );
    }

    const from = `FROM "team_recruitment_post" p
      JOIN "team" t ON t."id" = p."teamId"
      JOIN "player" c ON c."id" = t."captainId"
      WHERE ${where.join(' AND ')}`;
    const filterParams = [...sql.values];
    const [counted] = await this.dataSource.query<{ total: number }[]>(
      `SELECT COUNT(*)::int AS "total" ${from}`,
      filterParams,
    );
    const limit = sql.add(query.limit ?? RECRUITMENT_PAGE_SIZE_DEFAULT);
    const offset = sql.add(query.offset ?? 0);
    const ids = await this.dataSource.query<{ id: string }[]>(
      `SELECT p."id" ${from}
       ORDER BY COALESCE(c."vipUntil" > now(), false) DESC, p."createdAt" DESC, p."id"
       LIMIT ${limit} OFFSET ${offset}`,
      sql.values,
    );

    const posts = await this.loadPostsWithTeams(ids.map((r) => r.id));
    return {
      items: await this.toPostDtos(posts, actor),
      total: counted?.total ?? 0,
    };
  }

  async listPlayerListings(
    playerId: string,
    query: PlayerListingsQueryDto,
  ): Promise<PlayerListingsPageDto> {
    const actor = await this.loadActor(playerId);
    const sql = new SqlParams();
    const where = [`pl."teamId" IS NULL`];

    const search = query.search?.trim();
    if (search) {
      const like = sql.add(`%${escapeLike(search)}%`);
      where.push(
        `(pl."discordName" ILIKE ${like} OR pl."discordUsername" ILIKE ${like} OR pl."steamId" ILIKE ${like})`,
      );
    }
    if (query.ratingFrom !== undefined) {
      where.push(`pl."rating" >= ${sql.add(query.ratingFrom)}`);
    }
    if (query.ratingTo !== undefined) {
      where.push(`pl."rating" <= ${sql.add(query.ratingTo)}`);
    }
    if (query.ranks?.length) {
      const tiers = query.ranks.map((tier) => {
        const [lo, hi] = tierRange(tier);
        const from = `pl."rating" >= ${sql.add(lo)}`;
        return hi === null
          ? `(${from})`
          : `(${from} AND pl."rating" < ${sql.add(hi)})`;
      });
      where.push(`(${tiers.join(' OR ')})`);
    }
    if (query.positions?.length) {
      where.push(`pl."positions" && ${sql.add(query.positions)}::smallint[]`);
    }
    if (query.formats?.length) {
      where.push(`pl."wantToPlay" && ${sql.add(query.formats)}::varchar[]`);
    }
    if (query.lanCities?.length) {
      where.push(`pl."lanCities" && ${sql.add(query.lanCities)}::varchar[]`);
    }

    const from = `FROM "player_recruitment_post" l
      JOIN "player" pl ON pl."id" = l."playerId"
      WHERE ${where.join(' AND ')}`;
    const filterParams = [...sql.values];
    const [counted] = await this.dataSource.query<{ total: number }[]>(
      `SELECT COUNT(*)::int AS "total" ${from}`,
      filterParams,
    );
    const limit = sql.add(query.limit ?? RECRUITMENT_PAGE_SIZE_DEFAULT);
    const offset = sql.add(query.offset ?? 0);
    const ids = await this.dataSource.query<{ id: string }[]>(
      `SELECT l."id" ${from}
       ORDER BY COALESCE(pl."vipUntil" > now(), false) DESC, l."createdAt" DESC, l."id"
       LIMIT ${limit} OFFSET ${offset}`,
      sql.values,
    );

    const rows = ids.length
      ? await this.listings.find({
          where: { id: In(ids.map((r) => r.id)) },
          relations: ['player', 'player.roles'],
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids
      .map((r) => byId.get(r.id))
      .filter((r): r is PlayerRecruitmentPost => !!r);
    return {
      items: await this.toListingDtos(ordered, actor),
      total: counted?.total ?? 0,
    };
  }

  async getRequest(playerId: string, id: string): Promise<JoinRequestDto> {
    const actor = await this.loadActor(playerId);
    const row = await this.requests.findOne({
      where: { id },
      relations: ['post', 'createdBy'],
    });
    if (!row) {
      throw new NotFoundException({
        error: 'request_not_found',
        message: 'Запит не знайдено',
      });
    }
    const team = await this.teams.findOne({
      where: { id: row.teamId },
      relations: TEAM_DETAIL_RELATIONS,
    });
    if (!team) {
      throw new NotFoundException({
        error: 'team_not_found',
        message: 'Команду не знайдено',
      });
    }
    const isPlayer = row.playerId === playerId;
    const isManager =
      actor.isAdmin || RecruitmentService.isManager(team, playerId);
    if (!isPlayer && !isManager) {
      throw new ForbiddenException({
        error: 'not_participant',
        message: 'Цей запит вам недоступний',
      });
    }
    const player = await this.players.findOne({
      where: { id: row.playerId },
      relations: ['roles'],
    });
    if (!player) {
      throw new NotFoundException({
        error: 'player_not_found',
        message: 'Гравця не знайдено',
      });
    }

    const live =
      row.status === JoinRequestStatus.PENDING &&
      row.expiresAt.getTime() > Date.now() &&
      !team.disbandedAt;
    const isApplication = row.kind === JoinRequestKind.APPLICATION;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      message: row.message ?? null,
      position: row.position ?? null,
      slot: row.slot ?? null,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      respondedAt: row.respondedAt ?? null,
      player: RecruitmentService.toPlayerDto(player),
      team: this.teamsService.toTeamResponse(team),
      createdBy: row.createdBy
        ? {
            id: row.createdBy.id,
            discordName: row.createdBy.discordName ?? null,
            discordUsername: row.createdBy.discordUsername ?? null,
            avatarUrl: row.createdBy.avatarUrl ?? null,
          }
        : null,
      post: row.post
        ? {
            id: row.post.id,
            description: row.post.description ?? null,
            positions: row.post.positions,
            playersNeeded: row.post.playersNeeded,
            mmrMin: row.post.mmrMin ?? null,
            mmrMax: row.post.mmrMax ?? null,
            status: row.post.status,
          }
        : null,
      canRespond: live && (isApplication ? isManager : isPlayer),
      canWithdraw: live && (isApplication ? isPlayer : isManager),
    };
  }

  // ── team posts ───────────────────────────────────────────────────────────

  async createTeamPost(
    playerId: string,
    dto: CreateTeamPostDto,
  ): Promise<TeamPostDto> {
    const actor = await this.loadActor(playerId);
    const team = await this.loadTeam(dto.teamId);
    RecruitmentService.assertManager(team, actor);

    const shape = { mmrMin: dto.mmrMin ?? null, mmrMax: dto.mmrMax ?? null };
    RecruitmentService.validatePostShape(shape);

    const open = await this.posts.findOne({
      where: { teamId: team.id, status: TeamPostStatus.OPEN },
    });
    if (open) {
      throw new ConflictException({
        error: 'post_exists',
        message: 'У команди вже є активне оголошення — відредагуйте його',
      });
    }

    let saved: TeamRecruitmentPost;
    try {
      saved = await this.posts.save(
        this.posts.create({
          teamId: team.id,
          authorId: playerId,
          description: dto.description ?? null,
          positions: [...dto.positions].sort(),
          playersNeeded: dto.playersNeeded,
          ...shape,
          formats: dto.formats ?? [],
          status: TeamPostStatus.OPEN,
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          error: 'post_exists',
          message: 'У команди вже є активне оголошення — відредагуйте його',
        });
      }
      throw e;
    }
    this.logger.log(`team post ${saved.id} opened for team ${team.id}`);
    return this.toPostDto(saved.id, actor);
  }

  async updateTeamPost(
    playerId: string,
    id: string,
    dto: UpdateTeamPostDto,
  ): Promise<TeamPostDto> {
    const actor = await this.loadActor(playerId);
    const post = await this.findPost(id);
    RecruitmentService.assertPostOpen(post);
    const team = await this.loadTeam(post.teamId);
    RecruitmentService.assertManager(team, actor);

    if (dto.description !== undefined) {
      post.description = dto.description ?? null;
    }
    if (dto.positions !== undefined) post.positions = [...dto.positions].sort();
    if (dto.playersNeeded !== undefined) post.playersNeeded = dto.playersNeeded;
    if (dto.mmrMin !== undefined) post.mmrMin = dto.mmrMin ?? null;
    if (dto.mmrMax !== undefined) post.mmrMax = dto.mmrMax ?? null;
    if (dto.formats !== undefined) post.formats = dto.formats;
    RecruitmentService.validatePostShape(post);

    await this.posts.save(post);
    return this.toPostDto(post.id, actor);
  }

  async closeTeamPost(playerId: string, id: string): Promise<TeamPostDto> {
    const actor = await this.loadActor(playerId);
    const post = await this.findPost(id);
    RecruitmentService.assertPostOpen(post);
    const team = await this.teams.findOne({
      where: { id: post.teamId },
      relations: TEAM_RELATIONS,
    });
    if (team) RecruitmentService.assertManager(team, actor);
    else if (!actor.isAdmin) {
      throw new ForbiddenException({
        error: 'not_team_manager',
        message: 'Це може зробити лише капітан, тренер команди або адмін',
      });
    }
    await this.closePost(post);
    this.logger.log(`team post ${post.id} closed by ${playerId}`);
    return this.toPostDto(post.id, actor);
  }

  /** CLOSED + its pending applications cancelled. */
  private async closePost(post: TeamRecruitmentPost): Promise<void> {
    const updated = await this.posts.update(
      { id: post.id, status: TeamPostStatus.OPEN },
      { status: TeamPostStatus.CLOSED, closedAt: new Date() },
    );
    if (!updated.affected) return;
    const pending = await this.requests.find({
      where: { postId: post.id, status: JoinRequestStatus.PENDING },
    });
    await this.finishRequests(pending, JoinRequestStatus.CANCELLED);
  }

  // ── applications ─────────────────────────────────────────────────────────

  async apply(
    playerId: string,
    postId: string,
    dto: ApplyToTeamPostDto,
  ): Promise<TeamPostDto> {
    const actor = await this.loadActor(playerId);
    const post = await this.findPost(postId);
    RecruitmentService.assertPostOpen(post);
    const team = await this.loadTeam(post.teamId);

    RecruitmentService.throwBlocked(
      RecruitmentService.postBlocks(actor.player, post),
    );
    if (
      !RecruitmentService.matchingPositions(actor.player, post).includes(
        dto.position,
      )
    ) {
      throw new BadRequestException({
        error: 'position_not_offered',
        message: 'Оберіть одну зі своїх позицій, яку шукає команда',
      });
    }

    const existing = await this.requests.findOne({
      where: {
        kind: JoinRequestKind.APPLICATION,
        teamId: team.id,
        playerId,
        status: JoinRequestStatus.PENDING,
      },
    });
    if (existing) {
      throw new ConflictException({
        error: 'application_pending',
        message: 'Ви вже подали заявку до цієї команди',
      });
    }

    if (!isVipActive(actor.player)) {
      const sent = await this.countApplicationsToday(playerId);
      if (sent >= DAILY_APPLICATION_LIMIT) {
        throw new HttpException(
          {
            error: 'daily_application_limit',
            message: `Можна подати ${DAILY_APPLICATION_LIMIT} заявок на добу. З VIP — без обмежень`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const expiresAt = new Date(Date.now() + APPLICATION_TTL_MS);
    let saved: TeamJoinRequest;
    try {
      saved = await this.requests.save(
        this.requests.create({
          kind: JoinRequestKind.APPLICATION,
          teamId: team.id,
          playerId,
          postId: post.id,
          createdById: playerId,
          message: dto.message ?? null,
          position: dto.position,
          slot: null,
          status: JoinRequestStatus.PENDING,
          expiresAt,
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          error: 'application_pending',
          message: 'Ви вже подали заявку до цієї команди',
        });
      }
      throw e;
    }

    for (const managerId of RecruitmentService.managerIds(team)) {
      await this.notifications.create({
        playerId: managerId,
        type: NotificationType.TEAM_APPLICATION,
        refId: saved.id,
        status: NotificationStatus.PENDING,
        actor: actor.player,
        payload: {
          team: RecruitmentService.teamCard(team),
          expiresAt: expiresAt.toISOString(),
        },
      });
    }
    this.logger.log(`application ${saved.id}: ${playerId} → team ${team.id}`);
    return this.toPostDto(post.id, actor);
  }

  // ── invites ──────────────────────────────────────────────────────────────

  async invite(
    playerId: string,
    dto: CreateTeamInviteRequestDto,
  ): Promise<JoinRequestDto> {
    const actor = await this.loadActor(playerId);
    const team = await this.loadTeam(dto.teamId);
    RecruitmentService.assertManager(team, actor);

    if (dto.playerId === playerId) {
      throw new BadRequestException({
        error: 'self_invite',
        message: 'Не можна запросити самого себе',
      });
    }
    const target = await this.players.findOne({ where: { id: dto.playerId } });
    if (!target) {
      throw new NotFoundException({
        error: 'player_not_found',
        message: 'Гравця не знайдено',
      });
    }
    if (target.teamId) {
      throw new ConflictException({
        error: 'player_has_team',
        message: 'Гравець уже в команді',
      });
    }
    RecruitmentService.assertSlotOpen(team, dto.slot);

    const existing = await this.requests.findOne({
      where: {
        kind: JoinRequestKind.INVITE,
        teamId: team.id,
        playerId: target.id,
        status: JoinRequestStatus.PENDING,
      },
    });
    if (existing) {
      throw new ConflictException({
        error: 'invite_pending',
        message: 'Цьому гравцю вже надіслано запрошення',
      });
    }

    if (!isVipActive(actor.player) && !actor.isAdmin) {
      const sent = await this.countInvitesToday(team.id);
      if (sent >= DAILY_INVITE_LIMIT) {
        throw new HttpException(
          {
            error: 'daily_invite_limit',
            message: `Команда може надіслати ${DAILY_INVITE_LIMIT} запрошень на добу. З VIP — без обмежень`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    let saved: TeamJoinRequest;
    try {
      saved = await this.requests.save(
        this.requests.create({
          kind: JoinRequestKind.INVITE,
          teamId: team.id,
          playerId: target.id,
          postId: null,
          createdById: playerId,
          message: dto.message ?? null,
          position: null,
          slot: dto.slot,
          status: JoinRequestStatus.PENDING,
          expiresAt,
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          error: 'invite_pending',
          message: 'Цьому гравцю вже надіслано запрошення',
        });
      }
      throw e;
    }

    await this.notifications.create({
      playerId: target.id,
      type: NotificationType.TEAM_INVITE,
      refId: saved.id,
      status: NotificationStatus.PENDING,
      actor: actor.player,
      payload: {
        team: RecruitmentService.teamCard(team),
        expiresAt: expiresAt.toISOString(),
      },
    });
    this.logger.log(`invite ${saved.id}: team ${team.id} → ${target.id}`);
    return this.getRequest(playerId, saved.id);
  }

  // ── answering ────────────────────────────────────────────────────────────

  async accept(
    playerId: string,
    id: string,
    dto: AcceptJoinRequestDto,
  ): Promise<JoinRequestDto> {
    const actor = await this.loadActor(playerId);
    const row = await this.findRequest(id);
    await this.assertPending(row);
    const team = await this.loadTeam(row.teamId);
    const isApplication = row.kind === JoinRequestKind.APPLICATION;

    let slot: TeamMemberSlot;
    let joiner: Player;
    if (isApplication) {
      RecruitmentService.assertManager(team, actor);
      slot = dto.slot ?? RecruitmentService.autoSlot(team);
      const applicant = await this.players.findOne({
        where: { id: row.playerId },
        relations: ['roles'],
      });
      if (!applicant) {
        throw new NotFoundException({
          error: 'player_not_found',
          message: 'Гравця не знайдено',
        });
      }
      joiner = applicant;
    } else {
      if (row.playerId !== playerId) {
        throw new ForbiddenException({
          error: 'not_invitee',
          message: 'Прийняти запрошення може лише запрошений гравець',
        });
      }
      slot = row.slot ?? 'main';
      joiner = actor.player;
    }

    RecruitmentService.throwBlocked(
      RecruitmentService.playerBlocks(joiner).filter((r) =>
        JOIN_BLOCKS.includes(r),
      ),
    );
    RecruitmentService.assertSlotOpen(team, slot);

    await this.teamsService.addMemberToTeam(team.id, joiner.id, slot);
    await this.requests.update(
      { id: row.id },
      {
        status: JoinRequestStatus.ACCEPTED,
        slot,
        respondedAt: new Date(),
        respondedById: playerId,
      },
    );
    await this.notifications.resolveByRef(
      row.id,
      isApplication ? APPLICATION_TYPES : INVITE_TYPES,
      NotificationStatus.ACCEPTED,
    );

    const card = RecruitmentService.teamCard(team);
    if (isApplication) {
      await this.notifications.create({
        playerId: joiner.id,
        type: NotificationType.TEAM_APPLICATION_ACCEPTED,
        refId: row.id,
        actor: actor.player,
        payload: { team: card },
      });
    } else {
      for (const managerId of RecruitmentService.managerIds(team)) {
        await this.notifications.create({
          playerId: managerId,
          type: NotificationType.TEAM_INVITE_ACCEPTED,
          refId: row.id,
          actor: joiner,
          payload: { team: card },
        });
      }
    }

    await this.afterJoin(joiner.id, team.id, row);
    this.logger.log(
      `${row.kind.toLowerCase()} ${row.id} accepted: ${joiner.id} → team ${team.id} (${slot})`,
    );
    return this.getRequest(playerId, row.id);
  }

  async decline(playerId: string, id: string): Promise<JoinRequestDto> {
    const actor = await this.loadActor(playerId);
    const row = await this.findRequest(id);
    await this.assertPending(row);
    const team = await this.loadTeam(row.teamId);
    const isApplication = row.kind === JoinRequestKind.APPLICATION;

    if (isApplication) {
      RecruitmentService.assertManager(team, actor);
    } else if (row.playerId !== playerId) {
      throw new ForbiddenException({
        error: 'not_invitee',
        message: 'Відхилити запрошення може лише запрошений гравець',
      });
    }

    const updated = await this.requests.update(
      { id: row.id, status: JoinRequestStatus.PENDING },
      {
        status: JoinRequestStatus.DECLINED,
        respondedAt: new Date(),
        respondedById: playerId,
      },
    );
    if (updated.affected) {
      await this.notifications.resolveByRef(
        row.id,
        isApplication ? APPLICATION_TYPES : INVITE_TYPES,
        NotificationStatus.DECLINED,
      );
      const card = RecruitmentService.teamCard(team);
      if (isApplication) {
        await this.notifications.create({
          playerId: row.playerId,
          type: NotificationType.TEAM_APPLICATION_DECLINED,
          refId: row.id,
          actor: actor.player,
          payload: { team: card },
        });
      } else {
        for (const managerId of RecruitmentService.managerIds(team)) {
          await this.notifications.create({
            playerId: managerId,
            type: NotificationType.TEAM_INVITE_DECLINED,
            refId: row.id,
            actor: actor.player,
            payload: { team: card },
          });
        }
      }
    }
    return this.getRequest(playerId, row.id);
  }

  /** Applicant withdraws an application; a manager cancels an invite. */
  async withdraw(playerId: string, id: string): Promise<JoinRequestDto> {
    const actor = await this.loadActor(playerId);
    const row = await this.findRequest(id);
    if (row.status !== JoinRequestStatus.PENDING) {
      throw new ConflictException({
        error: 'request_not_pending',
        message: 'Запит уже не чекає на відповідь',
      });
    }
    if (row.kind === JoinRequestKind.APPLICATION) {
      if (row.playerId !== playerId) {
        throw new ForbiddenException({
          error: 'not_applicant',
          message: 'Відкликати заявку може лише її автор',
        });
      }
    } else {
      const team = await this.teams.findOne({
        where: { id: row.teamId },
        relations: TEAM_RELATIONS,
      });
      if (!team) {
        throw new NotFoundException({
          error: 'team_not_found',
          message: 'Команду не знайдено',
        });
      }
      RecruitmentService.assertManager(team, actor);
    }
    await this.finishRequests([row], JoinRequestStatus.CANCELLED);
    return this.getRequest(playerId, row.id);
  }

  /**
   * The player joined `teamId` through `accepted`: drop their other pending
   * requests and their listing, and count the newcomer against the team post.
   */
  private async afterJoin(
    joinerId: string,
    teamId: string,
    accepted: TeamJoinRequest,
  ): Promise<void> {
    const others = await this.requests.find({
      where: {
        playerId: joinerId,
        status: JoinRequestStatus.PENDING,
        id: Not(accepted.id),
      },
    });
    await this.finishRequests(others, JoinRequestStatus.CANCELLED);
    await this.listings.delete({ playerId: joinerId });

    const post = accepted.postId
      ? await this.posts.findOne({
          where: { id: accepted.postId, status: TeamPostStatus.OPEN },
        })
      : await this.posts.findOne({
          where: { teamId, status: TeamPostStatus.OPEN },
        });
    if (!post) return;
    const left = Math.max(0, post.playersNeeded - 1);
    await this.posts.update({ id: post.id }, { playersNeeded: left });
    if (left === 0) await this.closePost(post);
  }

  /** PENDING → `status` (only rows still pending), mirrored onto their bell entries. */
  private async finishRequests(
    rows: TeamJoinRequest[],
    status: JoinRequestStatus,
  ): Promise<void> {
    const notificationStatus =
      status === JoinRequestStatus.EXPIRED
        ? NotificationStatus.EXPIRED
        : NotificationStatus.CANCELLED;
    for (const row of rows) {
      const updated = await this.requests.update(
        { id: row.id, status: JoinRequestStatus.PENDING },
        { status, respondedAt: new Date() },
      );
      if (!updated.affected) continue;
      await this.notifications.resolveByRef(
        row.id,
        REQUEST_TYPES,
        notificationStatus,
      );
    }
  }

  // ── player listings ──────────────────────────────────────────────────────

  async upsertMyListing(
    playerId: string,
    dto: UpsertPlayerListingDto,
  ): Promise<PlayerListingDto> {
    const actor = await this.loadActor(playerId);
    RecruitmentService.throwBlocked(
      RecruitmentService.playerBlocks(actor.player),
    );
    const existing = await this.listings.findOne({ where: { playerId } });
    if (existing) {
      existing.description = dto.description ?? null;
      await this.listings.save(existing);
    } else {
      try {
        await this.listings.save(
          this.listings.create({
            playerId,
            description: dto.description ?? null,
          }),
        );
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        await this.listings.update(
          { playerId },
          { description: dto.description ?? null },
        );
      }
    }
    const row = await this.listings.findOneOrFail({
      where: { playerId },
      relations: ['player', 'player.roles'],
    });
    const [dtoOut] = await this.toListingDtos([row], actor);
    return dtoOut;
  }

  async deleteMyListing(playerId: string): Promise<void> {
    await this.listings.delete({ playerId });
  }

  /** Admin moderation. */
  async deleteListing(playerId: string, id: string): Promise<void> {
    const actor = await this.loadActor(playerId);
    const row = await this.listings.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException({
        error: 'listing_not_found',
        message: 'Оголошення не знайдено',
      });
    }
    if (row.playerId !== playerId && !actor.isAdmin) {
      throw new ForbiddenException({
        error: 'not_listing_owner',
        message: 'Видалити оголошення може лише автор або адмін',
      });
    }
    await this.listings.delete({ id });
  }

  // ── housekeeping ─────────────────────────────────────────────────────────

  /**
   * Periodic cleanup: overdue requests expire; requests and listings of
   * players who joined a team some other way (invite link, admin) go away;
   * posts of disbanded teams close.
   */
  async sweep(): Promise<void> {
    const overdue = await this.requests.find({
      where: {
        status: JoinRequestStatus.PENDING,
        expiresAt: LessThan(new Date()),
      },
    });
    await this.finishRequests(overdue, JoinRequestStatus.EXPIRED);

    const joined = await this.dataSource.query<{ id: string }[]>(
      `SELECT r."id" FROM "team_join_request" r
       JOIN "player" pl ON pl."id" = r."playerId"
       WHERE r."status" = 'PENDING' AND pl."teamId" IS NOT NULL`,
    );
    if (joined.length) {
      const rows = await this.requests.find({
        where: { id: In(joined.map((r) => r.id)) },
      });
      await this.finishRequests(rows, JoinRequestStatus.CANCELLED);
    }

    await this.dataSource.query(
      `DELETE FROM "player_recruitment_post" l USING "player" pl
       WHERE pl."id" = l."playerId" AND pl."teamId" IS NOT NULL`,
    );

    const orphaned = await this.dataSource.query<{ id: string }[]>(
      `SELECT p."id" FROM "team_recruitment_post" p
       JOIN "team" t ON t."id" = p."teamId"
       WHERE p."status" = 'OPEN' AND t."disbandedAt" IS NOT NULL`,
    );
    for (const { id } of orphaned) {
      const post = await this.posts.findOne({ where: { id } });
      if (post) await this.closePost(post);
    }

    if (overdue.length || joined.length || orphaned.length) {
      this.logger.log(
        `sweep: expired ${overdue.length}, dropped ${joined.length} request(s), closed ${orphaned.length} post(s)`,
      );
    }
  }
}
