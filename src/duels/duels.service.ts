import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThan,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import { discordChannelUrl } from '../discord/discord-links';
import { Player } from '../players/player.entity';
import { isVipActive } from '../vip/vip.utils';
import {
  DUEL_ACCEPT_WINDOW_SECONDS,
  DUEL_RESULT_RECOVERY_WINDOW_SECONDS,
  DUEL_ACTIVE_STATES,
  DUEL_HOSTED_STATES,
  DUEL_CANCEL_PENALTY,
  DUEL_CHALLENGE_DAILY_LIMIT,
  DUEL_DEFAULT_REGION,
  DUEL_FRIEND_RATING_DELTA,
  DUEL_INVITE_REQUEST_COOLDOWN_SECONDS,
  DUEL_JOIN_TIMEOUT_SECONDS,
  DUEL_LOBBY_NAME_DEFAULT,
  DUEL_MAX_LOBBY_RESTARTS,
  DUEL_NEVER_STARTED_GAME_STATES,
  DUEL_NO_SHOW_COOLDOWN_SECONDS,
  DUEL_PLAYER_CANCELLABLE_STATES,
  DUEL_QUEUE_WINDOW_BASE,
  DUEL_QUEUE_WINDOW_STEP,
  DUEL_QUEUE_WINDOW_STEP_SECONDS,
  DUEL_RATING_FLOOR,
  DUEL_RESTART_REQUEST_COOLDOWN_SECONDS,
  DUEL_RESTART_REQUEST_WINDOW_SECONDS,
  DUEL_TERMINAL_STATES,
  DUEL_VOICE_CHANNEL_STATES,
  DuelCancelReason,
  DuelChallengeStatus,
  DuelFailReason,
  DuelKind,
  DuelState,
  DuelTournamentStatus,
  MATCH_OUTCOME_DIRE,
  MATCH_OUTCOME_RADIANT,
  duelRatingDeltaFor,
  type DuelLobbyPlayer,
  type DuelStats,
} from './duel.constants';
import { Duel } from './duel.entity';
import { DuelChallenge } from './duel-challenge.entity';
import { DuelEventsPublisher } from './duel-events.publisher';
import { heroById, pickRandomHeroes } from './dota-heroes';
import { DuelQueueEntry } from './duel-queue.entity';
import { DuelRating } from './duel-rating.entity';
import { DuelTournament } from './duel-tournament.entity';
import { DuelTournamentParticipant } from './duel-tournament-participant.entity';
import { HostBot } from './host-bot.entity';
import { HostBotsService } from './host-bots.service';
import { AdminDuelDto, AdminPurgeDuelsResultDto } from './dto/duel-admin.dto';
import {
  DuelBotsStatusDto,
  DuelChallengeDto,
  DuelChallengesStateDto,
  DuelDto,
  DuelHeroDto,
  DuelLeaderboardDto,
  DuelPlayerDto,
  DuelPlayerProfileDto,
  DuelQueueBlockedReason,
  DuelRatingDto,
  DuelStatusDto,
} from './dto/duel.dto';

const RECENT_DUELS_LIMIT = 10;

/** Result the bot reports after POSTGAME. */
export interface DuelGcResult {
  dotaMatchId: string | null;
  matchOutcome: number;
  /** Hero each player actually played (from the lobby / scoreboard), when known. */
  heroesPlayed?: Array<{ playerId: string; heroId: number }>;
}

/** What `toDuelDto` needs besides the duel: ratings for the player cards and tournament names. */
interface DuelDtoLookups {
  /** Ladder lines by player id. */
  ratings: Map<string, DuelRating>;
  tournaments: Map<string, DuelTournament>;
  /** Tournament ratings by `${tournamentId}:${playerId}`. */
  tournamentRatings: Map<string, number>;
}

/** A player's numbers on the board a duel counts for: the ladder or a tournament. */
type DuelRatingLine = DuelRating | DuelTournamentParticipant;

/**
 * The 1v1 ladder's business rules: queue membership, status for the page,
 * applying results to ratings, history and the leaderboard. Used by api-v1
 * (HTTP + matchmaker) and by the bot-worker (state transitions), so nothing
 * here may depend on a request.
 */
@Injectable()
export class DuelsService {
  private readonly logger = new Logger(DuelsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Duel) private readonly duels: Repository<Duel>,
    @InjectRepository(DuelRating)
    private readonly ratings: Repository<DuelRating>,
    @InjectRepository(DuelQueueEntry)
    private readonly queue: Repository<DuelQueueEntry>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(DuelChallenge)
    private readonly challenges: Repository<DuelChallenge>,
    @InjectRepository(DuelTournament)
    private readonly tournaments: Repository<DuelTournament>,
    @InjectRepository(DuelTournamentParticipant)
    private readonly participants: Repository<DuelTournamentParticipant>,
    private readonly hostBots: HostBotsService,
    /** Every write below that changes what a player sees announces itself here (→ socket pushes). */
    private readonly events: DuelEventsPublisher,
  ) {}

  // ── mapping ──────────────────────────────────────────────────────────────

  private toRatingDto(row: DuelRating | null, playerId: string): DuelRatingDto {
    const wins = row?.wins ?? 0;
    const losses = row?.losses ?? 0;
    const played = wins + losses;
    return {
      playerId,
      rating: row?.rating ?? 0,
      wins,
      losses,
      streak: row?.streak ?? 0,
      winrate: played > 0 ? Math.round((wins * 100) / played) : null,
      lastPlayedAt: row?.lastPlayedAt ?? null,
      cooldownUntil: row?.cooldownUntil ?? null,
    };
  }

  /** Player card; `rating` is the ladder rating, or the tournament one on a tournament duel / board. */
  toPlayerDto(player: Player | null, rating: number): DuelPlayerDto | null {
    if (!player) return null;
    return {
      id: player.id,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      avatarUrl: player.avatarUrl ?? null,
      steamId: player.steamId ?? null,
      rating,
    };
  }

  /** Rating to print on a duel's player card: the tournament line for a tournament duel. */
  private ratingIn(
    duel: Duel,
    playerId: string | null,
    lookups: DuelDtoLookups,
  ): number {
    if (!playerId) return 0;
    if (duel.tournamentId) {
      return (
        lookups.tournamentRatings.get(`${duel.tournamentId}:${playerId}`) ?? 0
      );
    }
    return lookups.ratings.get(playerId)?.rating ?? 0;
  }

  private toHeroDto(pick: { playerId: string; heroId: number }): DuelHeroDto {
    const hero = heroById(pick.heroId);
    return {
      playerId: pick.playerId,
      heroId: pick.heroId,
      name: hero?.name ?? `npc_dota_hero_${pick.heroId}`,
      localizedName: hero?.localizedName ?? `Hero #${pick.heroId}`,
    };
  }

  private isLobbyOpen(state: DuelState): boolean {
    return (
      state === DuelState.LOBBY_CREATING ||
      state === DuelState.WAITING_PLAYERS ||
      state === DuelState.LIVE
    );
  }

  private toDuelDto(
    duel: Duel,
    lookups: DuelDtoLookups,
    viewerId: string | null,
  ): DuelDto {
    const tournament = duel.tournamentId
      ? lookups.tournaments.get(duel.tournamentId)
      : undefined;
    const isParticipant =
      viewerId != null &&
      (duel.player1Id === viewerId || duel.player2Id === viewerId);
    const showPassword = isParticipant && this.isLobbyOpen(duel.state);
    const showVoice =
      isParticipant &&
      !!duel.discordVoiceChannelId &&
      DUEL_VOICE_CHANNEL_STATES.includes(duel.state);
    return {
      id: duel.id,
      number: duel.number,
      state: duel.state,
      kind: duel.kind ?? DuelKind.RANKED,
      tournament: tournament
        ? { id: tournament.id, name: tournament.name }
        : null,
      createdAt: duel.createdAt,
      lobbyReadyAt: duel.lobbyReadyAt,
      liveAt: duel.liveAt,
      finishedAt: duel.finishedAt,
      joinDeadlineAt: duel.lobbyReadyAt
        ? new Date(
            duel.lobbyReadyAt.getTime() + DUEL_JOIN_TIMEOUT_SECONDS * 1000,
          )
        : null,
      acceptDeadlineAt: duel.acceptDeadlineAt,
      acceptedPlayerIds: duel.acceptedPlayerIds ?? [],
      player1: this.toPlayerDto(
        duel.player1,
        this.ratingIn(duel, duel.player1Id, lookups),
      ),
      player2: this.toPlayerDto(
        duel.player2,
        this.ratingIn(duel, duel.player2Id, lookups),
      ),
      player1Rating: duel.player1Rating,
      player2Rating: duel.player2Rating,
      lobbyName: duel.lobbyName,
      lobbyPassword: showPassword ? duel.lobbyPassword : null,
      heroes: duel.heroes ? duel.heroes.map((h) => this.toHeroDto(h)) : null,
      discordVoiceChannelUrl: showVoice
        ? discordChannelUrl(duel.discordVoiceChannelId as string)
        : null,
      lobbyPlayers: duel.lobbyPlayers,
      radiantPlayerId: duel.radiantPlayerId,
      direPlayerId: duel.direPlayerId,
      winnerId: duel.winnerId,
      loserId: duel.loserId,
      dotaMatchId: duel.dotaMatchId,
      ratingDelta: duel.ratingDelta,
      cancelReason: duel.cancelReason,
      failReason: duel.failReason,
      cancelledById: duel.cancelledById,
      adminReviewRequired: duel.adminReviewRequired,
      lobbyRestarts: duel.lobbyRestarts ?? 0,
      gameState: duel.gameState ?? null,
      stats: duel.stats,
    };
  }

  /** Ladder lines, tournament lines and tournament names the duel cards need. */
  private async lookupsFor(duels: Duel[]): Promise<DuelDtoLookups> {
    const ladderIds = new Set<string>();
    const tournamentIds = new Set<string>();
    for (const d of duels) {
      if (d.tournamentId) {
        tournamentIds.add(d.tournamentId);
        continue;
      }
      if (d.player1Id) ladderIds.add(d.player1Id);
      if (d.player2Id) ladderIds.add(d.player2Id);
    }
    const [ratingRows, tournamentRows, lineRows] = await Promise.all([
      ladderIds.size
        ? this.ratings.find({ where: { playerId: In([...ladderIds]) } })
        : Promise.resolve([] as DuelRating[]),
      tournamentIds.size
        ? this.tournaments.find({
            where: { id: In([...tournamentIds]) },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as DuelTournament[]),
      tournamentIds.size
        ? this.participants.find({
            where: { tournamentId: In([...tournamentIds]) },
            select: { tournamentId: true, playerId: true, rating: true },
          })
        : Promise.resolve([] as DuelTournamentParticipant[]),
    ]);
    return {
      ratings: new Map(ratingRows.map((r) => [r.playerId, r])),
      tournaments: new Map(tournamentRows.map((t) => [t.id, t])),
      tournamentRatings: new Map(
        lineRows.map((l) => [`${l.tournamentId}:${l.playerId}`, l.rating]),
      ),
    };
  }

  async toDtos(duels: Duel[], viewerId: string | null): Promise<DuelDto[]> {
    const lookups = await this.lookupsFor(duels);
    return duels.map((d) => this.toDuelDto(d, lookups, viewerId));
  }

  private toChallengeDto(
    row: DuelChallenge,
    ratings: Map<string, DuelRating>,
  ): DuelChallengeDto {
    return {
      id: row.id,
      status: row.status,
      challenger: this.toPlayerDto(
        row.challenger,
        ratings.get(row.challengerId)?.rating ?? 0,
      )!,
      challenged: this.toPlayerDto(
        row.challenged,
        ratings.get(row.challengedId)?.rating ?? 0,
      )!,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      respondedAt: row.respondedAt,
      duelId: row.duelId,
    };
  }

  // ── friend challenges (reads shared with DuelChallengesService) ──────────

  /** Friendly duels the player accepted (as either side) on the current Kyiv day. */
  async countAcceptedChallengesToday(playerId: string): Promise<number> {
    const rows: Array<{ count: number | string }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count
         FROM "duel_challenge"
        WHERE "status" = $1
          AND ("challengerId" = $2 OR "challengedId" = $2)
          AND ("respondedAt" AT TIME ZONE 'Europe/Kyiv')::date = (now() AT TIME ZONE 'Europe/Kyiv')::date`,
      [DuelChallengeStatus.ACCEPTED, playerId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Open challenges of the player (not yet expired), newest first, with both players loaded. */
  private listPendingChallenges(playerId: string): Promise<DuelChallenge[]> {
    const now = new Date();
    return this.challenges.find({
      where: [
        {
          challengerId: playerId,
          status: DuelChallengeStatus.PENDING,
          expiresAt: MoreThan(now),
        },
        {
          challengedId: playerId,
          status: DuelChallengeStatus.PENDING,
          expiresAt: MoreThan(now),
        },
      ],
      relations: ['challenger', 'challenged'],
      order: { createdAt: 'DESC' },
    });
  }

  private async challengesState(
    playerId: string,
  ): Promise<DuelChallengesStateDto> {
    const [rows, acceptedToday, me] = await Promise.all([
      this.listPendingChallenges(playerId),
      this.countAcceptedChallengesToday(playerId),
      this.players.findOne({
        where: { id: playerId },
        select: { id: true, vipUntil: true },
      }),
    ]);
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.challengerId);
      ids.add(r.challengedId);
    }
    const ratings = ids.size
      ? new Map(
          (await this.ratings.find({ where: { playerId: In([...ids]) } })).map(
            (r) => [r.playerId, r],
          ),
        )
      : new Map<string, DuelRating>();
    const dtos = rows.map((r) => this.toChallengeDto(r, ratings));
    return {
      incoming: dtos.filter((c) => c.challenged.id === playerId),
      outgoing: dtos.find((c) => c.challenger.id === playerId) ?? null,
      acceptedToday,
      dailyLimit: DUEL_CHALLENGE_DAILY_LIMIT,
      unlimited: isVipActive(me),
      ratingDelta: DUEL_FRIEND_RATING_DELTA,
    };
  }

  // ── lookups ──────────────────────────────────────────────────────────────

  /** Duel with both players loaded; null when it does not exist. */
  findDuelEntity(id: string): Promise<Duel | null> {
    return this.duels.findOne({
      where: { id },
      relations: ['player1', 'player2'],
    });
  }

  async getDuel(id: string, viewerId: string | null): Promise<DuelDto> {
    const duel = await this.findDuelEntity(id);
    if (!duel) throw new NotFoundException('Duel not found');
    const [dto] = await this.toDtos([duel], viewerId);
    return dto;
  }

  findActiveDuelForPlayer(playerId: string): Promise<Duel | null> {
    return this.duels.findOne({
      where: [
        { player1Id: playerId, state: In([...DUEL_ACTIVE_STATES]) },
        { player2Id: playerId, state: In([...DUEL_ACTIVE_STATES]) },
      ],
      relations: ['player1', 'player2'],
      order: { createdAt: 'DESC' },
    });
  }

  /** The two participants of a duel (for pushes); empty when the duel is gone. */
  async findDuelPlayerIds(duelId: string): Promise<string[]> {
    const row = await this.duels.findOne({
      where: { id: duelId },
      select: { id: true, player1Id: true, player2Id: true },
    });
    return [row?.player1Id, row?.player2Id].filter((p): p is string => !!p);
  }

  /**
   * The duel shown as the result banner: the newest terminal one, or the one
   * whose game is over but whose result is still being collected (PROCESSING).
   */
  private findLastFinishedDuelForPlayer(
    playerId: string,
  ): Promise<Duel | null> {
    const states = [...DUEL_TERMINAL_STATES, DuelState.PROCESSING];
    return this.duels.findOne({
      where: [
        { player1Id: playerId, state: In(states) },
        { player2Id: playerId, state: In(states) },
      ],
      relations: ['player1', 'player2'],
      order: { finishedAt: 'DESC', createdAt: 'DESC' },
    });
  }

  private async ensureRating(
    playerId: string,
    em: EntityManager = this.dataSource.manager,
  ): Promise<DuelRating> {
    await em
      .createQueryBuilder()
      .insert()
      .into(DuelRating)
      .values({ playerId })
      .orIgnore()
      .execute();
    const row = await em.findOne(DuelRating, { where: { playerId } });
    if (!row) throw new Error(`duel_rating row missing for ${playerId}`);
    return row;
  }

  /**
   * The line a duel's result is written to: the tournament's own table for a
   * tournament duel (row created if the player somehow has none), the ladder
   * otherwise. Tournament duels never touch `duel_rating` numbers: a
   * tournament duel whose tournament an admin deleted (`tournamentId` set to
   * null by the FK) has no line at all — null, nothing is written.
   */
  private async ratingLine(
    em: EntityManager,
    duel: Pick<Duel, 'tournamentId' | 'kind'>,
    playerId: string,
  ): Promise<DuelRatingLine | null> {
    const tournamentId = duel.tournamentId;
    if (!tournamentId) {
      if (duel.kind === DuelKind.TOURNAMENT) return null;
      return this.ensureRating(playerId, em);
    }
    await em
      .createQueryBuilder()
      .insert()
      .into(DuelTournamentParticipant)
      .values({ tournamentId, playerId })
      .orIgnore()
      .execute();
    const row = await em.findOne(DuelTournamentParticipant, {
      where: { tournamentId, playerId },
    });
    if (!row) {
      throw new Error(
        `duel_tournament_participant row missing for ${tournamentId}/${playerId}`,
      );
    }
    return row;
  }

  /** Queue cooldown after a no-show — always on the ladder row, it gates every queue. */
  private async setQueueCooldown(
    em: EntityManager,
    playerId: string,
    cooldownUntil: Date,
  ): Promise<void> {
    await this.ensureRating(playerId, em);
    await em.update(DuelRating, { playerId }, { cooldownUntil });
  }

  // ── queue ────────────────────────────────────────────────────────────────

  static queueWindow(waitSeconds: number): number {
    return (
      DUEL_QUEUE_WINDOW_BASE +
      DUEL_QUEUE_WINDOW_STEP *
        Math.floor(waitSeconds / DUEL_QUEUE_WINDOW_STEP_SECONDS)
    );
  }

  private async queueBlockedReason(
    player: Player,
    rating: DuelRating | null,
    queued: boolean,
    bots: DuelBotsStatusDto,
  ): Promise<DuelQueueBlockedReason | null> {
    if (!player.steamId) return DuelQueueBlockedReason.STEAM_NOT_LINKED;
    if (queued) return DuelQueueBlockedReason.ALREADY_QUEUED;
    if (rating?.cooldownUntil && rating.cooldownUntil.getTime() > Date.now()) {
      return DuelQueueBlockedReason.COOLDOWN;
    }
    if (await this.findActiveDuelForPlayer(player.id)) {
      return DuelQueueBlockedReason.ACTIVE_DUEL;
    }
    if (bots.online === 0) return DuelQueueBlockedReason.NO_BOTS_ONLINE;
    return null;
  }

  /**
   * Joins the ladder queue, or a tournament's queue when `tournamentId` is
   * given (ACTIVE tournament, player already entered its password). Waiting
   * in the other queue moves the player over.
   */
  async joinQueue(
    playerId: string,
    tournamentId: string | null = null,
  ): Promise<DuelStatusDto> {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');
    const rating = await this.ensureRating(playerId);
    let queueRating = rating.rating;
    if (tournamentId) {
      queueRating = await this.tournamentQueueRating(tournamentId, playerId);
    }
    const existing = await this.queue.findOne({ where: { playerId } });
    const queued =
      existing != null && (existing.tournamentId ?? null) === tournamentId;
    const bots = await this.hostBots.publicStatus();
    const blocked = await this.queueBlockedReason(player, rating, queued, bots);
    if (blocked === DuelQueueBlockedReason.STEAM_NOT_LINKED) {
      throw new BadRequestException({
        error: blocked,
        message: 'Прив’яжіть Steam-акаунт у профілі, щоб грати дуелі',
      });
    }
    if (blocked === DuelQueueBlockedReason.COOLDOWN) {
      throw new HttpException(
        {
          error: blocked,
          message: 'Після неявки черга недоступна кілька хвилин',
          cooldownUntil: rating.cooldownUntil,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (blocked === DuelQueueBlockedReason.ACTIVE_DUEL) {
      throw new ConflictException({
        error: blocked,
        message: 'У вас уже є активна дуель',
      });
    }
    if (blocked === DuelQueueBlockedReason.NO_BOTS_ONLINE) {
      throw new HttpException(
        {
          error: blocked,
          message: 'Жоден бот-хост зараз не онлайн — черга тимчасово закрита',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (blocked === DuelQueueBlockedReason.ALREADY_QUEUED) {
      return this.getStatus(playerId);
    }
    const now = new Date();
    // Waiting in the other queue (ladder ↔ tournament): move over.
    if (existing) await this.queue.delete({ playerId });
    await this.queue
      .createQueryBuilder()
      .insert()
      .into(DuelQueueEntry)
      .values({
        playerId,
        rating: queueRating,
        tournamentId,
        joinedAt: now,
        lastSeenAt: now,
      })
      .orIgnore()
      .execute();
    this.events.queueChanged();
    return this.getStatus(playerId);
  }

  /** Tournament rating to queue with; throws unless the tournament is ACTIVE and the player joined it. */
  private async tournamentQueueRating(
    tournamentId: string,
    playerId: string,
  ): Promise<number> {
    const tournament = await this.tournaments.findOne({
      where: { id: tournamentId },
      select: { id: true, status: true },
    });
    if (!tournament) throw new NotFoundException('Турнір не знайдено');
    if (tournament.status !== DuelTournamentStatus.ACTIVE) {
      throw new ConflictException({
        error: 'tournament_ended',
        message: 'Турнір уже завершено',
      });
    }
    const line = await this.participants.findOne({
      where: { tournamentId, playerId },
      select: { tournamentId: true, playerId: true, rating: true },
    });
    if (!line) {
      throw new ForbiddenException({
        error: 'not_tournament_participant',
        message: 'Спершу увійдіть у турнір за паролем',
      });
    }
    return line.rating;
  }

  async leaveQueue(playerId: string): Promise<DuelStatusDto> {
    const removed = await this.queue.delete({ playerId });
    if (removed.affected) this.events.queueChanged();
    return this.getStatus(playerId);
  }

  /**
   * Queue heartbeat for players whose socket is connected: their rows stay
   * fresh without any HTTP polling (the matchmaker prunes everyone else).
   */
  async touchQueue(playerIds: string[]): Promise<void> {
    if (!playerIds.length) return;
    await this.queue.update(
      { playerId: In(playerIds) },
      { lastSeenAt: new Date() },
    );
  }

  /**
   * Page snapshot. By default also the queue heartbeat (`lastSeenAt`) — the
   * REST poll and the socket's first snapshot; pushes pass `touch: false`.
   */
  async getStatus(
    playerId: string,
    opts: { touch?: boolean } = {},
  ): Promise<DuelStatusDto> {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');

    const now = new Date();
    if (opts.touch !== false) {
      await this.queue.update({ playerId }, { lastSeenAt: now });
    }
    const [
      entry,
      playersInQueue,
      rating,
      active,
      lastFinished,
      bots,
      challenges,
    ] = await Promise.all([
      this.queue.findOne({ where: { playerId } }),
      // Top-level count is the ladder queue; a tournament queue is counted below.
      this.queue.count({ where: { tournamentId: IsNull() } }),
      this.ratings.findOne({ where: { playerId } }),
      this.findActiveDuelForPlayer(playerId),
      this.findLastFinishedDuelForPlayer(playerId),
      this.hostBots.publicStatus(),
      this.challengesState(playerId),
    ]);

    const toDto = [active, lastFinished].filter((d): d is Duel => d != null);
    const dtos = await this.toDtos(toDto, playerId);
    const activeDto = active ? (dtos.shift() ?? null) : null;
    const lastFinishedDto = lastFinished ? (dtos.shift() ?? null) : null;

    const blocked = await this.queueBlockedReason(
      player,
      rating,
      entry != null,
      bots,
    );
    const waitSeconds = entry
      ? Math.max(
          0,
          Math.floor((now.getTime() - entry.joinedAt.getTime()) / 1000),
        )
      : 0;
    const [entryTournament, entryQueueSize] = entry?.tournamentId
      ? await Promise.all([
          this.tournaments.findOne({
            where: { id: entry.tournamentId },
            select: { id: true, name: true },
          }),
          this.queue.count({ where: { tournamentId: entry.tournamentId } }),
        ])
      : [null, playersInQueue];

    return {
      rating: this.toRatingDto(rating, playerId),
      queue: entry
        ? {
            joinedAt: entry.joinedAt,
            waitSeconds,
            window: DuelsService.queueWindow(waitSeconds),
            playersInQueue: entryQueueSize,
            tournament: entryTournament
              ? { id: entryTournament.id, name: entryTournament.name }
              : null,
          }
        : null,
      activeDuel: activeDto,
      lastFinishedDuel: lastFinishedDto,
      canQueue: blocked == null,
      queueBlockedReason: blocked,
      playersInQueue,
      bots,
      challenges,
    };
  }

  // ── accept / cancel by players ───────────────────────────────────────────

  /** Throws unless `playerId` is one of the two players; returns the opponent id ('' when unknown). */
  private assertParticipant(duel: Duel, playerId: string): string {
    const opponentId =
      duel.player1Id === playerId
        ? duel.player2Id
        : duel.player2Id === playerId
          ? duel.player1Id
          : undefined;
    if (opponentId === undefined) {
      throw new ForbiddenException({
        error: 'not_participant',
        message: 'Це не ваша дуель',
      });
    }
    return opponentId ?? '';
  }

  /**
   * −points (floor 0) on the duel's board and an optional queue cooldown for
   * a player who bailed on a found match.
   */
  private async applyPenalty(
    em: EntityManager,
    duel: Duel,
    playerId: string,
    points: number,
    cooldownUntil: Date | null,
  ): Promise<void> {
    const line = await this.ratingLine(em, duel, playerId);
    if (line) {
      line.rating = Math.max(DUEL_RATING_FLOOR, line.rating - points);
      await em.save(line);
    }
    if (cooldownUntil) await this.setQueueCooldown(em, playerId, cooldownUntil);
  }

  /**
   * Player presses Accept. Once both did, the duel moves to PENDING and a
   * host bot may claim it. Accepting after the deadline is refused; the
   * matchmaker expires the duel on its next tick.
   */
  async acceptDuel(duelId: string, playerId: string): Promise<DuelStatusDto> {
    await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) throw new NotFoundException('Duel not found');
      this.assertParticipant(duel, playerId);
      if (duel.state !== DuelState.ACCEPTING) {
        if (DUEL_ACTIVE_STATES.includes(duel.state)) return; // both already accepted
        throw new ConflictException({
          error: 'duel_not_accepting',
          message: 'Матч уже не чекає на прийняття',
        });
      }
      if (
        duel.acceptDeadlineAt &&
        duel.acceptDeadlineAt.getTime() < Date.now()
      ) {
        throw new ConflictException({
          error: 'accept_expired',
          message: 'Час на прийняття матчу вичерпано',
        });
      }
      const accepted = new Set(duel.acceptedPlayerIds ?? []);
      accepted.add(playerId);
      duel.acceptedPlayerIds = [...accepted];
      const both =
        !!duel.player1Id &&
        !!duel.player2Id &&
        accepted.has(duel.player1Id) &&
        accepted.has(duel.player2Id);
      if (both) duel.state = DuelState.PENDING;
      await em.save(duel);
    });
    this.events.duelChanged(duelId);
    return this.getStatus(playerId);
  }

  /**
   * Matchmaker tick: ACCEPTING duels past their deadline. Nobody accepted →
   * plain cancel, both simply leave the queue. One accepted → the other loses
   * DUEL_CANCEL_PENALTY and gets a cooldown, the accepter is re-queued.
   */
  async expireAcceptTimeouts(): Promise<number> {
    const stale = await this.duels.find({
      where: {
        state: DuelState.ACCEPTING,
        acceptDeadlineAt: LessThan(new Date()),
      },
      select: { id: true },
    });
    for (const { id } of stale) {
      await this.dataSource.transaction(async (em) => {
        const duel = await em.findOne(Duel, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!duel || duel.state !== DuelState.ACCEPTING) return;
        const now = new Date();
        const accepted = new Set(duel.acceptedPlayerIds ?? []);
        const participants = [duel.player1Id, duel.player2Id].filter(
          (p): p is string => !!p,
        );
        const absent = participants.filter((p) => !accepted.has(p));
        const present = participants.filter((p) => accepted.has(p));

        duel.state = DuelState.CANCELLED;
        duel.cancelReason = DuelCancelReason.ACCEPT_TIMEOUT;
        duel.finishedAt = now;
        if (present.length && absent.length === 1) {
          const cooldownUntil = new Date(
            now.getTime() + DUEL_NO_SHOW_COOLDOWN_SECONDS * 1000,
          );
          await this.applyPenalty(
            em,
            duel,
            absent[0],
            DUEL_CANCEL_PENALTY,
            cooldownUntil,
          );
          duel.loserId = absent[0];
          duel.ratingDelta = DUEL_CANCEL_PENALTY;
          duel.ratingAppliedAt = now;
          duel.error = `not accepted by ${absent[0]}`;
        } else {
          duel.error = 'not accepted by both';
        }
        const saved = await em.save(duel);
        if (present.length) await this.requeuePlayers(saved, em, present);
      });
      this.events.duelChanged(id);
      this.events.queueChanged();
      this.logger.log(`Duel ${id} expired: accept timeout`);
    }
    return stale.length;
  }

  /**
   * Participant cancels before the game is LIVE: −DUEL_CANCEL_PENALTY for the
   * caller, the opponent goes straight back into the queue. The host bot
   * notices the terminal state on its next tick and leaves the lobby.
   */
  async playerCancelDuel(
    duelId: string,
    playerId: string,
  ): Promise<DuelStatusDto> {
    await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) throw new NotFoundException('Duel not found');
      const opponentId = this.assertParticipant(duel, playerId);
      if (!DUEL_PLAYER_CANCELLABLE_STATES.includes(duel.state)) {
        throw new ConflictException({
          error: 'duel_not_cancellable',
          message: DUEL_TERMINAL_STATES.includes(duel.state)
            ? 'Дуель уже завершена'
            : 'Гру вже запущено — скасувати не можна',
        });
      }
      const now = new Date();
      await this.applyPenalty(em, duel, playerId, DUEL_CANCEL_PENALTY, null);
      duel.state = DuelState.CANCELLED;
      duel.cancelReason = DuelCancelReason.PLAYER_CANCELLED;
      duel.cancelledById = playerId;
      duel.loserId = playerId;
      duel.ratingDelta = DUEL_CANCEL_PENALTY;
      duel.ratingAppliedAt = now;
      duel.finishedAt = now;
      duel.error = `cancelled by player ${playerId}`;
      const saved = await em.save(duel);
      if (opponentId) await this.requeuePlayers(saved, em, [opponentId]);
    });
    this.events.duelChanged(duelId);
    this.events.queueChanged();
    this.logger.log(
      `Duel ${duelId} cancelled by player ${playerId} (−${DUEL_CANCEL_PENALTY})`,
    );
    return this.getStatus(playerId);
  }

  /**
   * "Invite me again" from the site: participants only, while the lobby is
   * open (WAITING_PLAYERS). The request is stored on the duel and the host
   * bot re-sends the Dota invite on its next tick — once per player per
   * DUEL_INVITE_REQUEST_COOLDOWN_SECONDS.
   */
  async requestInvite(
    duelId: string,
    playerId: string,
  ): Promise<DuelStatusDto> {
    await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) throw new NotFoundException('Duel not found');
      this.assertParticipant(duel, playerId);
      if (duel.state !== DuelState.WAITING_PLAYERS) {
        throw new ConflictException({
          error: 'lobby_not_open',
          message:
            duel.state === DuelState.LOBBY_CREATING
              ? 'Лобі ще створюється — зачекайте кілька секунд'
              : 'Лобі вже закрите',
        });
      }
      const now = new Date();
      const last = duel.inviteRequests?.[playerId];
      if (
        last &&
        now.getTime() - new Date(last).getTime() <
          DUEL_INVITE_REQUEST_COOLDOWN_SECONDS * 1000
      ) {
        throw new HttpException(
          {
            error: 'invite_cooldown',
            message: `Інвайт уже надіслано — повторити можна за ${DUEL_INVITE_REQUEST_COOLDOWN_SECONDS} с`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      duel.inviteRequests = {
        ...(duel.inviteRequests ?? {}),
        [playerId]: now.toISOString(),
      };
      await em.save(duel);
    });
    this.events.duelChanged(duelId);
    this.logger.log(
      `Duel ${duelId}: player ${playerId} asked for a new invite`,
    );
    return this.getStatus(playerId);
  }

  /**
   * "Restart the match" from the site: a player failed to load and the game
   * sits on the loading screen. Participants only, while the duel is LIVE,
   * the pick phase has not begun (`gameState` still a loading state), the
   * launch is recent and the restart budget is not spent. The request is
   * stored on the duel; the host bot double-checks the live scoreboard on its
   * next tick and relaunches the lobby (same one when it still hosts it).
   * Once per player per DUEL_RESTART_REQUEST_COOLDOWN_SECONDS.
   */
  async requestRestart(
    duelId: string,
    playerId: string,
  ): Promise<DuelStatusDto> {
    await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) throw new NotFoundException('Duel not found');
      this.assertParticipant(duel, playerId);
      if (duel.state !== DuelState.LIVE) {
        const message =
          duel.state === DuelState.LOBBY_CREATING ||
          duel.state === DuelState.WAITING_PLAYERS
            ? 'Лобі ще не запущено — перезапуск потрібен лише коли гра не стартувала'
            : duel.state === DuelState.PROCESSING
              ? 'Гра вже зіграна — результат обробляється'
              : 'Дуель не активна';
        throw new ConflictException({ error: 'not_restartable', message });
      }
      if ((duel.lobbyRestarts ?? 0) >= DUEL_MAX_LOBBY_RESTARTS) {
        throw new ConflictException({
          error: 'restart_limit',
          message: `Ліміт перезапусків лобі (${DUEL_MAX_LOBBY_RESTARTS}) вичерпано`,
        });
      }
      if (
        duel.gameState != null &&
        !DUEL_NEVER_STARTED_GAME_STATES.has(duel.gameState)
      ) {
        throw new ConflictException({
          error: 'game_started',
          message: 'Гра вже стартувала — герої обрані, перезапуск неможливий',
        });
      }
      const now = new Date();
      if (
        duel.liveAt &&
        now.getTime() - duel.liveAt.getTime() >
          DUEL_RESTART_REQUEST_WINDOW_SECONDS * 1000
      ) {
        throw new ConflictException({
          error: 'game_started',
          message: 'Гра запущена надто давно — перезапуск більше недоступний',
        });
      }
      const last = duel.restartRequests?.[playerId];
      if (
        last &&
        now.getTime() - new Date(last).getTime() <
          DUEL_RESTART_REQUEST_COOLDOWN_SECONDS * 1000
      ) {
        throw new HttpException(
          {
            error: 'restart_cooldown',
            message: `Запит уже надіслано — повторити можна за ${DUEL_RESTART_REQUEST_COOLDOWN_SECONDS} с`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      duel.restartRequests = {
        ...(duel.restartRequests ?? {}),
        [playerId]: now.toISOString(),
      };
      await em.save(duel);
    });
    this.events.duelChanged(duelId);
    this.logger.log(
      `Duel ${duelId}: player ${playerId} asked to restart the match`,
    );
    return this.getStatus(playerId);
  }

  // ── matchmaker helpers ───────────────────────────────────────────────────

  static generateLobbyPassword(): string {
    // 8 chars, unambiguous alphabet — players type this into the Dota client.
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(8);
    let out = '';
    for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  /** Lobby name / region of hosted lobbies; env overrides are forwarded by the CI even when blank. */
  static lobbySettingsFromEnv(): { lobbyName: string; region: number } {
    const lobbyName =
      process.env.HOSTBOT_LOBBY_NAME?.trim() || DUEL_LOBBY_NAME_DEFAULT;
    // An empty/unset HOSTBOT_REGION means the default, not region 0.
    const rawRegion = process.env.HOSTBOT_REGION?.trim();
    const region = rawRegion ? Number(rawRegion) : NaN;
    return {
      lobbyName,
      region:
        Number.isFinite(region) && region > 0 ? region : DUEL_DEFAULT_REGION,
    };
  }

  /**
   * Friendly duel from an accepted challenge, inside the caller's transaction:
   * both players already agreed, so it starts in PENDING (no accept window)
   * and the next free host bot claims it like any other duel. ±10 on result.
   */
  async createFriendDuel(
    em: EntityManager,
    challengerId: string,
    challengedId: string,
  ): Promise<Duel> {
    const [r1, r2] = await Promise.all([
      this.ensureRating(challengerId, em),
      this.ensureRating(challengedId, em),
    ]);
    const { lobbyName, region } = DuelsService.lobbySettingsFromEnv();
    const duel = em.create(Duel, {
      state: DuelState.PENDING,
      kind: DuelKind.FRIEND,
      acceptDeadlineAt: null,
      acceptedPlayerIds: [challengerId, challengedId],
      heroes: pickRandomHeroes(2).map((hero, ix) => ({
        playerId: ix === 0 ? challengerId : challengedId,
        heroId: hero.id,
      })),
      player1Id: challengerId,
      player2Id: challengedId,
      player1Rating: r1.rating,
      player2Rating: r2.rating,
      lobbyName,
      lobbyPassword: DuelsService.generateLobbyPassword(),
      region,
    });
    return em.save(duel);
  }

  /**
   * Creates the duel and removes both players from the queue atomically.
   * Returns null when either player left the queue in the meantime.
   */
  async createDuelFromQueue(
    p1: DuelQueueEntry,
    p2: DuelQueueEntry,
    lobbyName: string,
    region: number,
  ): Promise<Duel | null> {
    const duel = await this.dataSource
      .transaction(async (em) => {
        const removed = await em.delete(DuelQueueEntry, {
          playerId: In([p1.playerId, p2.playerId]),
        });
        if ((removed.affected ?? 0) !== 2) {
          throw new QueueRaceError();
        }
        // The matchmaker pairs within one queue, so both entries share it.
        const tournamentId = p1.tournamentId ?? null;
        const duel = em.create(Duel, {
          state: DuelState.ACCEPTING,
          kind: tournamentId ? DuelKind.TOURNAMENT : DuelKind.RANKED,
          tournamentId,
          acceptDeadlineAt: new Date(
            Date.now() + DUEL_ACCEPT_WINDOW_SECONDS * 1000,
          ),
          acceptedPlayerIds: [],
          heroes: pickRandomHeroes(2).map((hero, ix) => ({
            playerId: ix === 0 ? p1.playerId : p2.playerId,
            heroId: hero.id,
          })),
          player1Id: p1.playerId,
          player2Id: p2.playerId,
          player1Rating: p1.rating,
          player2Rating: p2.rating,
          lobbyName,
          lobbyPassword: DuelsService.generateLobbyPassword(),
          region,
        });
        return em.save(duel);
      })
      .catch((err: unknown) => {
        if (err instanceof QueueRaceError) return null;
        throw err;
      });
    if (duel) {
      this.events.duelChanged(duel.id);
      this.events.queueChanged();
    }
    return duel;
  }

  /**
   * Puts the duel's players back into the queue (after `no_bots_available`,
   * a cancel by the other side, …). `only` limits it to a subset. Friendly
   * duels never came from the queue, so nobody is put there. Tournament
   * duels go back to their tournament's queue — only while it is ACTIVE.
   */
  async requeuePlayers(
    duel: Duel,
    em: EntityManager,
    only?: string[],
  ): Promise<void> {
    if (duel.kind === DuelKind.FRIEND) return;
    const tournamentId = duel.tournamentId ?? null;
    // Its tournament was deleted — never fall through into the ladder queue.
    if (duel.kind === DuelKind.TOURNAMENT && !tournamentId) return;
    if (tournamentId) {
      const tournament = await em.findOne(DuelTournament, {
        where: { id: tournamentId },
        select: { id: true, status: true },
      });
      if (tournament?.status !== DuelTournamentStatus.ACTIVE) return;
    }
    const now = new Date();
    const values = [
      duel.player1Id && {
        playerId: duel.player1Id,
        rating: duel.player1Rating,
      },
      duel.player2Id && {
        playerId: duel.player2Id,
        rating: duel.player2Rating,
      },
    ]
      .filter((v): v is { playerId: string; rating: number } => !!v)
      .filter((v) => !only || only.includes(v.playerId));
    if (!values.length) return;
    await em
      .createQueryBuilder()
      .insert()
      .into(DuelQueueEntry)
      .values(
        values.map((v) => ({
          ...v,
          tournamentId,
          joinedAt: now,
          lastSeenAt: now,
        })),
      )
      .orIgnore()
      .execute();
  }

  // ── worker transitions ───────────────────────────────────────────────────

  /**
   * Atomically hands the oldest PENDING duel to `hostBotId`. Safe to call from
   * several workers at once (`FOR UPDATE SKIP LOCKED`). Returns the duel with
   * both players loaded, or null when nothing is waiting.
   */
  async claimPendingDuel(hostBotId: number): Promise<Duel | null> {
    const result: unknown = await this.dataSource.query(
      `UPDATE "duel"
         SET "hostBotId" = $1, "state" = $2, "updatedAt" = now()
       WHERE "id" = (
         SELECT "id" FROM "duel"
          WHERE "state" = $3 AND "hostBotId" IS NULL
          ORDER BY "createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       RETURNING "id"`,
      [hostBotId, DuelState.LOBBY_CREATING, DuelState.PENDING],
    );
    // pg driver: [rows, affected] for UPDATE … RETURNING
    const rows = (
      Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
    ) as Array<{ id: string }>;
    const id = rows?.[0]?.id;
    if (!id) return null;
    this.events.duelChanged(id);
    return this.findDuelEntity(id);
  }

  /** Reverts a claimed duel to PENDING (bot could not create the lobby right away but is still healthy). */
  async releaseClaim(duelId: string): Promise<void> {
    await this.duels.update(
      { id: duelId, state: DuelState.LOBBY_CREATING },
      { hostBotId: null, state: DuelState.PENDING },
    );
    this.events.duelChanged(duelId);
  }

  async markLobbyReady(duelId: string, lobbyId: string): Promise<void> {
    await this.duels.update(
      { id: duelId },
      { lobbyId, state: DuelState.WAITING_PLAYERS, lobbyReadyAt: new Date() },
    );
    this.events.duelChanged(duelId);
  }

  async updateLobbyPlayers(
    duelId: string,
    players: DuelLobbyPlayer[],
  ): Promise<void> {
    await this.duels.update({ id: duelId }, { lobbyPlayers: players });
    this.events.duelChanged(duelId);
  }

  async markLive(
    duelId: string,
    radiantPlayerId: string,
    direPlayerId: string,
  ): Promise<void> {
    await this.duels.update(
      { id: duelId },
      {
        state: DuelState.LIVE,
        liveAt: new Date(),
        radiantPlayerId,
        direPlayerId,
      },
    );
    this.events.duelChanged(duelId);
  }

  /**
   * The game server started and the GC dropped the bot from the lobby: the
   * match counts as finished for the players (they may queue again) while the
   * result is still collected. No-op unless the duel is LIVE.
   */
  async markProcessing(duelId: string): Promise<void> {
    const res = await this.duels.update(
      { id: duelId, state: DuelState.LIVE },
      { state: DuelState.PROCESSING, finishedAt: new Date() },
    );
    if (res.affected) this.events.duelChanged(duelId);
  }

  /**
   * The launched game never started (a player failed to load, the server
   * aborted the match) and the bot relaunches the lobby. LIVE / PROCESSING go
   * back to WAITING_PLAYERS (`sameLobby`) or LOBBY_CREATING (a fresh lobby),
   * with everything the launch had produced cleared, and the restart counted.
   *
   * PROCESSING had already freed the players, so the transition is refused
   * (`player_busy`) when one of them is in another duel by now; a queue row
   * they created meanwhile is removed — their own match resumes instead.
   * `limit_reached` once `DUEL_MAX_LOBBY_RESTARTS` relaunches were spent; the
   * caller cancels the duel then.
   */
  async restartLobby(
    duelId: string,
    opts: { sameLobby: boolean; reason: string },
  ): Promise<
    'restarted' | 'player_busy' | 'limit_reached' | 'not_restartable'
  > {
    let dequeued = 0;
    const result = await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !duel ||
        (duel.state !== DuelState.LIVE && duel.state !== DuelState.PROCESSING)
      ) {
        return 'not_restartable' as const;
      }
      if ((duel.lobbyRestarts ?? 0) >= DUEL_MAX_LOBBY_RESTARTS) {
        return 'limit_reached' as const;
      }
      const playerIds = [duel.player1Id, duel.player2Id].filter(
        (id): id is string => !!id,
      );
      if (playerIds.length) {
        const busy = await em
          .createQueryBuilder(Duel, 'd')
          .where('d.id != :id', { id: duel.id })
          .andWhere('d.state IN (:...states)', { states: DUEL_ACTIVE_STATES })
          .andWhere('(d.player1Id IN (:...ids) OR d.player2Id IN (:...ids))', {
            ids: playerIds,
          })
          .getCount();
        if (busy > 0) return 'player_busy' as const;
        const removed = await em.delete(DuelQueueEntry, {
          playerId: In(playerIds),
        });
        dequeued = removed.affected ?? 0;
      }

      duel.state = opts.sameLobby
        ? DuelState.WAITING_PLAYERS
        : DuelState.LOBBY_CREATING;
      duel.lobbyRestarts = (duel.lobbyRestarts ?? 0) + 1;
      duel.error = opts.reason;
      duel.liveAt = null;
      duel.finishedAt = null;
      duel.radiantPlayerId = null;
      duel.direPlayerId = null;
      duel.dotaMatchId = null;
      duel.serverSteamId = null;
      duel.matchOutcome = null;
      duel.stats = null;
      duel.inviteRequests = null;
      duel.restartRequests = null;
      duel.gameState = null;
      if (opts.sameLobby) {
        duel.lobbyReadyAt = new Date();
      } else {
        duel.lobbyId = null;
        duel.lobbyReadyAt = null;
        duel.lobbyPlayers = null;
      }
      await em.save(duel);
      return 'restarted' as const;
    });
    if (result === 'restarted') {
      this.events.duelChanged(duelId);
      if (dequeued > 0) this.events.queueChanged();
    }
    return result;
  }

  /** Valve match id becomes known at launch; stored early so a restarted worker can still resolve the game. */
  async saveMatchId(duelId: string, dotaMatchId: string): Promise<void> {
    await this.duels.update(
      { id: duelId, dotaMatchId: IsNull() },
      { dotaMatchId },
    );
  }

  /** Game server id, stored as soon as the lobby reports it, so a restarted worker can keep following the game. */
  async saveServerId(duelId: string, serverSteamId: string): Promise<void> {
    await this.duels.update({ id: duelId }, { serverSteamId });
  }

  async saveStats(duelId: string, stats: DuelStats): Promise<void> {
    await this.duels.update({ id: duelId }, { stats });
    this.events.duelChanged(duelId);
  }

  /**
   * Dota `game_state` from the live scoreboard, stored while the duel is LIVE
   * so the API and the site can tell whether the pick phase has begun. Only
   * the LIVE row is touched — a relaunch already cleared it.
   */
  async saveGameState(duelId: string, gameState: number): Promise<void> {
    const res = await this.duels.update(
      { id: duelId, state: DuelState.LIVE },
      { gameState },
    );
    if (res.affected) this.events.duelChanged(duelId);
  }

  /**
   * Final result from the Game Coordinator. Applies ±25 (±10 for a friendly
   * duel) to both ladder lines in one transaction; idempotent (a second call
   * for the same duel is a no-op).
   * An outcome that names neither side leaves the duel FAILED for an admin.
   */
  async applyGcResult(duelId: string, result: DuelGcResult): Promise<Duel> {
    const saved = await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) throw new NotFoundException('Duel not found');
      if (duel.ratingAppliedAt) return duel;

      duel.dotaMatchId = result.dotaMatchId ?? duel.dotaMatchId;
      duel.matchOutcome = result.matchOutcome;

      let winnerId =
        result.matchOutcome === MATCH_OUTCOME_RADIANT
          ? duel.radiantPlayerId
          : result.matchOutcome === MATCH_OUTCOME_DIRE
            ? duel.direPlayerId
            : null;
      let loserId =
        winnerId == null
          ? null
          : winnerId === duel.radiantPlayerId
            ? duel.direPlayerId
            : duel.radiantPlayerId;

      // Random-hero rule: whoever ignored their drawn hero forfeits, whatever
      // the scoreboard says. Both ignored it → admins decide.
      const violators = this.heroViolators(duel, result.heroesPlayed);
      if (violators.length === 2) {
        duel.state = DuelState.FAILED;
        duel.failReason = DuelFailReason.WRONG_HEROES;
        duel.adminReviewRequired = true;
        duel.finishedAt = new Date();
        duel.error = 'both players picked a different hero';
        return em.save(duel);
      }
      if (violators.length === 1) {
        loserId = violators[0];
        winnerId = loserId === duel.player1Id ? duel.player2Id : duel.player1Id;
        duel.error = `forfeit: ${loserId} picked a different hero`;
      }

      if (!winnerId || !loserId) {
        duel.state = DuelState.FAILED;
        duel.failReason = DuelFailReason.UNDETERMINED_OUTCOME;
        duel.adminReviewRequired = true;
        duel.finishedAt = new Date();
        return em.save(duel);
      }

      await this.applyWinLoss(em, duel, winnerId, loserId, null);
      duel.failReason = null;
      duel.cancelReason = null;
      return em.save(duel);
    });
    this.events.duelChanged(duelId);
    return saved;
  }

  /**
   * FAILED duels whose result may still be fetched from Valve: the lobby was
   * lost or POSTGAME came without an outcome, but the match id is known and
   * the game finished recently enough for `GetMatchDetails` to have it.
   */
  findRecoverableFailedDuels(): Promise<Duel[]> {
    const since = new Date(
      Date.now() - DUEL_RESULT_RECOVERY_WINDOW_SECONDS * 1000,
    );
    return this.duels.find({
      where: {
        state: DuelState.FAILED,
        adminReviewRequired: true,
        failReason: In([
          DuelFailReason.LOBBY_LOST,
          DuelFailReason.UNDETERMINED_OUTCOME,
        ]),
        dotaMatchId: Not(IsNull()),
        finishedAt: MoreThan(since),
      },
      relations: ['player1', 'player2'],
      order: { finishedAt: 'ASC' },
      take: 20,
    });
  }

  /** Players who played a hero other than the one drawn for them (needs both lists). */
  private heroViolators(
    duel: Duel,
    played: DuelGcResult['heroesPlayed'],
  ): string[] {
    if (!duel.heroes?.length || !played?.length) return [];
    const actual = new Map(played.map((p) => [p.playerId, p.heroId]));
    return duel.heroes
      .filter((h) => {
        const heroId = actual.get(h.playerId);
        return heroId != null && heroId > 0 && heroId !== h.heroId;
      })
      .map((h) => h.playerId);
  }

  private async applyWinLoss(
    em: EntityManager,
    duel: Duel,
    winnerId: string,
    loserId: string,
    adminId: string | null,
  ): Promise<void> {
    const now = new Date();
    const winner = await this.ratingLine(em, duel, winnerId);
    const loser = await this.ratingLine(em, duel, loserId);
    // No lines: the duel's tournament was deleted — the result stands, no table changes.
    const delta = winner && loser ? duelRatingDeltaFor(duel.kind) : 0;

    if (winner && loser) {
      winner.rating += delta;
      winner.wins += 1;
      winner.streak = winner.streak > 0 ? winner.streak + 1 : 1;
      winner.lastPlayedAt = now;

      loser.rating = Math.max(DUEL_RATING_FLOOR, loser.rating - delta);
      loser.losses += 1;
      loser.streak = loser.streak < 0 ? loser.streak - 1 : -1;
      loser.lastPlayedAt = now;

      await em.save([winner, loser]);
    }

    duel.state = DuelState.RESOLVED;
    duel.winnerId = winnerId;
    duel.loserId = loserId;
    duel.ratingDelta = delta;
    duel.ratingAppliedAt = now;
    duel.finishedAt = duel.finishedAt ?? now;
    duel.adminReviewRequired = false;
    duel.resolvedByAdminId = adminId;
    if (!duel.error?.startsWith('forfeit:')) duel.error = null;
  }

  /**
   * Nobody (or only one player) showed up. The absent player loses the duel's
   * delta (25, or 10 in a friendly duel; floor 0) and gets a queue cooldown;
   * the present player is untouched.
   * A no-show is not a played game, so wins/losses stay as they were.
   */
  async applyNoShow(duelId: string, absentPlayerIds: string[]): Promise<Duel> {
    const saved = await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) throw new NotFoundException('Duel not found');
      if (DUEL_TERMINAL_STATES.includes(duel.state)) return duel;

      const now = new Date();
      const delta = duelRatingDeltaFor(duel.kind);
      const cooldownUntil = new Date(
        now.getTime() + DUEL_NO_SHOW_COOLDOWN_SECONDS * 1000,
      );
      for (const playerId of absentPlayerIds) {
        await this.applyPenalty(em, duel, playerId, delta, cooldownUntil);
      }
      duel.state = DuelState.CANCELLED;
      duel.cancelReason = DuelCancelReason.PLAYERS_NO_SHOW;
      duel.ratingDelta = absentPlayerIds.length ? delta : null;
      duel.ratingAppliedAt = absentPlayerIds.length ? now : null;
      duel.finishedAt = now;
      duel.error = absentPlayerIds.length
        ? `no-show: ${absentPlayerIds.join(', ')}`
        : 'no-show: both';
      return em.save(duel);
    });
    this.events.duelChanged(duelId);
    return saved;
  }

  async cancelDuel(
    duelId: string,
    reason: DuelCancelReason,
    opts: {
      requeue?: boolean;
      /** Re-queue only these players (implies requeue). */
      requeueOnly?: string[];
      error?: string;
      cancelledById?: string | null;
    } = {},
  ): Promise<Duel | null> {
    let requeued = false;
    const saved = await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) return null;
      if (DUEL_TERMINAL_STATES.includes(duel.state)) return duel;
      duel.state = DuelState.CANCELLED;
      duel.cancelReason = reason;
      duel.finishedAt = new Date();
      if (opts.error) duel.error = opts.error;
      if (opts.cancelledById) duel.cancelledById = opts.cancelledById;
      const saved = await em.save(duel);
      if (opts.requeueOnly?.length) {
        await this.requeuePlayers(saved, em, opts.requeueOnly);
        requeued = true;
      } else if (opts.requeue) {
        await this.requeuePlayers(saved, em);
        requeued = true;
      }
      return saved;
    });
    if (saved) {
      this.events.duelChanged(duelId);
      if (requeued) this.events.queueChanged();
    }
    return saved;
  }

  async failDuel(
    duelId: string,
    reason: DuelFailReason,
    error?: string,
  ): Promise<Duel | null> {
    const saved = await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) return null;
      if (DUEL_TERMINAL_STATES.includes(duel.state)) return duel;
      duel.state = DuelState.FAILED;
      duel.failReason = reason;
      duel.adminReviewRequired = true;
      duel.finishedAt = new Date();
      if (error) duel.error = error;
      return em.save(duel);
    });
    if (saved) this.events.duelChanged(duelId);
    return saved;
  }

  /**
   * State + pending "invite me" requests — the worker polls this each tick
   * to notice admin cancels and invite requests from the site.
   */
  async getWorkerView(duelId: string): Promise<{
    state: DuelState;
    inviteRequests: Record<string, string> | null;
    restartRequests: Record<string, string> | null;
  } | null> {
    const row = await this.duels.findOne({
      where: { id: duelId },
      select: {
        id: true,
        state: true,
        inviteRequests: true,
        restartRequests: true,
      },
    });
    return row
      ? {
          state: row.state,
          inviteRequests: row.inviteRequests ?? null,
          restartRequests: row.restartRequests ?? null,
        }
      : null;
  }

  /** Every duel a bot claimed that has not finished — what a restarted worker must reconcile. */
  findActiveClaimedDuels(): Promise<Duel[]> {
    return this.duels.find({
      where: {
        state: In([...DUEL_HOSTED_STATES]),
      },
      relations: ['player1', 'player2'],
      order: { createdAt: 'ASC' },
    });
  }

  // ── public reads ─────────────────────────────────────────────────────────

  async getLeaderboard(): Promise<DuelLeaderboardDto> {
    const rows = await this.ratings
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.player', 'p')
      .where('r.wins + r.losses >= 1')
      .orderBy('r.rating', 'DESC')
      .addOrderBy('r.wins', 'DESC')
      .addOrderBy('r.losses', 'ASC')
      .addOrderBy('r.lastPlayedAt', 'DESC', 'NULLS LAST')
      .getMany();
    return {
      generatedAt: new Date(),
      players: rows.map((r, index) => {
        const played = r.wins + r.losses;
        return {
          position: index + 1,
          player: this.toPlayerDto(r.player, r.rating)!,
          rating: r.rating,
          wins: r.wins,
          losses: r.losses,
          winrate: played > 0 ? Math.round((r.wins * 100) / played) : null,
          streak: r.streak,
          lastPlayedAt: r.lastPlayedAt,
        };
      }),
    };
  }

  /**
   * A tournament's own board: every participant (also those who have not
   * played yet — the organiser sees who is in), best rating first.
   */
  async getTournamentLeaderboard(
    tournamentId: string,
  ): Promise<DuelLeaderboardDto> {
    const rows = await this.participants
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.player', 'p')
      .where('t.tournamentId = :tournamentId', { tournamentId })
      .orderBy('t.rating', 'DESC')
      .addOrderBy('t.wins', 'DESC')
      .addOrderBy('t.losses', 'ASC')
      .addOrderBy('t.lastPlayedAt', 'DESC', 'NULLS LAST')
      .addOrderBy('t.joinedAt', 'ASC')
      .getMany();
    return {
      generatedAt: new Date(),
      players: rows.map((r, index) => {
        const played = r.wins + r.losses;
        return {
          position: index + 1,
          player: this.toPlayerDto(r.player, r.rating)!,
          rating: r.rating,
          wins: r.wins,
          losses: r.losses,
          winrate: played > 0 ? Math.round((r.wins * 100) / played) : null,
          streak: r.streak,
          lastPlayedAt: r.lastPlayedAt,
        };
      }),
    };
  }

  async getPlayerProfile(
    playerId: string,
    viewerId: string | null,
  ): Promise<DuelPlayerProfileDto> {
    const [rating, recent] = await Promise.all([
      this.ratings.findOne({ where: { playerId } }),
      this.duels.find({
        where: [{ player1Id: playerId }, { player2Id: playerId }],
        relations: ['player1', 'player2'],
        order: { createdAt: 'DESC' },
        take: RECENT_DUELS_LIMIT,
      }),
    ]);
    return {
      rating: rating ? this.toRatingDto(rating, playerId) : null,
      recent: await this.toDtos(recent, viewerId),
    };
  }

  // ── admin ────────────────────────────────────────────────────────────────

  async adminList(
    state: DuelState | undefined,
    limit: number,
  ): Promise<AdminDuelDto[]> {
    const rows = await this.duels.find({
      where: state ? { state } : {},
      relations: ['player1', 'player2'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
    const dtos = await this.toDtos(rows, null);
    return rows.map((duel, ix) => this.toAdminDto(duel, dtos[ix]));
  }

  /** Public DTO plus the bookkeeping only an admin needs to judge a stuck duel. */
  private toAdminDto(duel: Duel, dto: DuelDto): AdminDuelDto {
    return {
      ...dto,
      hostBotId: duel.hostBotId,
      lobbyId: duel.lobbyId,
      serverSteamId: duel.serverSteamId,
      matchOutcome: duel.matchOutcome,
      ratingAppliedAt: duel.ratingAppliedAt,
      error: duel.error,
      resolvedByAdminId: duel.resolvedByAdminId,
      updatedAt: duel.updatedAt,
    };
  }

  /**
   * Delete one duel row for good. Any state is allowed: a bot still hosting
   * it sees the row gone on its next tick and leaves the lobby, and the bot's
   * `currentDuelId` is cleared here so the pool view does not point at a
   * ghost. Rating changes the duel already applied are NOT rolled back —
   * that is what resolve / set-rating are for. Irreversible — admin only.
   */
  async adminDelete(duelId: string, adminId: string): Promise<void> {
    const duel = await this.duels.findOne({ where: { id: duelId } });
    if (!duel) throw new NotFoundException('Duel not found');
    await this.dataSource.transaction(async (em) => {
      await em
        .createQueryBuilder()
        .update(HostBot)
        .set({ currentDuelId: null })
        .where({ currentDuelId: duelId })
        .execute();
      await em
        .createQueryBuilder()
        .delete()
        .from(Duel)
        .where({ id: duelId })
        .execute();
    });
    // The participants' snapshots (active duel, result banner) are stale now.
    this.events.queueChanged();
    this.events.botsChanged();
    this.logger.warn(
      `Duel #${duel.number} (${duelId}, ${duel.state}) deleted by admin ${adminId}`,
    );
  }

  /**
   * Admin cancel: no rating change. When the admin is one of the two players
   * (cancelling their own match) the opponent is re-queued automatically.
   */
  async adminCancel(duelId: string, adminId: string): Promise<DuelDto> {
    const existing = await this.duels.findOne({ where: { id: duelId } });
    if (!existing) throw new NotFoundException('Duel not found');
    const opponentId =
      existing.player1Id === adminId
        ? existing.player2Id
        : existing.player2Id === adminId
          ? existing.player1Id
          : null;
    const duel = await this.cancelDuel(duelId, DuelCancelReason.ADMIN, {
      error: 'cancelled by admin',
      cancelledById: adminId,
      requeueOnly: opponentId ? [opponentId] : undefined,
    });
    if (!duel) throw new NotFoundException('Duel not found');
    this.logger.log(`Duel ${duelId} cancelled by admin ${adminId}`);
    return this.getDuel(duelId, null);
  }

  /** FAILED / CANCELLED duel: credit a winner (±25) or void it (no rating change). */
  async adminResolve(
    duelId: string,
    winnerId: string | null,
    adminId: string,
  ): Promise<DuelDto> {
    await this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) throw new NotFoundException('Duel not found');
      if (
        duel.state !== DuelState.FAILED &&
        duel.state !== DuelState.CANCELLED
      ) {
        throw new ConflictException({
          error: 'duel_not_reviewable',
          message: 'Вирішити вручну можна лише FAILED або CANCELLED дуель',
        });
      }
      if (winnerId == null) {
        duel.adminReviewRequired = false;
        duel.resolvedByAdminId = adminId;
        duel.error = 'voided by admin';
        await em.save(duel);
        return;
      }
      const loserId =
        winnerId === duel.player1Id
          ? duel.player2Id
          : winnerId === duel.player2Id
            ? duel.player1Id
            : null;
      if (!loserId) {
        throw new BadRequestException({
          error: 'winner_not_participant',
          message: 'Переможець має бути одним із двох гравців дуелі',
        });
      }
      duel.cancelReason = null;
      duel.failReason = null;
      await this.applyWinLoss(em, duel, winnerId, loserId, adminId);
      await em.save(duel);
    });
    this.events.duelChanged(duelId);
    this.logger.log(
      `Duel ${duelId} resolved by admin ${adminId}: winner=${winnerId ?? 'void'}`,
    );
    return this.getDuel(duelId, null);
  }

  /**
   * Full ladder reset: every duel, rating line and queue entry goes away and
   * host bots forget their current duel. Workers notice the missing duel on
   * their next tick and leave the lobby. Irreversible — admin only.
   */
  async adminPurgeAll(adminId: string): Promise<AdminPurgeDuelsResultDto> {
    const result = await this.dataSource.transaction(async (em) => {
      const queue =
        (await em.createQueryBuilder().delete().from(DuelQueueEntry).execute())
          .affected ?? 0;
      const duels =
        (await em.createQueryBuilder().delete().from(Duel).execute())
          .affected ?? 0;
      const ratings =
        (await em.createQueryBuilder().delete().from(DuelRating).execute())
          .affected ?? 0;
      await em
        .createQueryBuilder()
        .update(HostBot)
        .set({ currentDuelId: null })
        .execute();
      return { duels, ratings, queue };
    });
    // Every connected player's snapshot is stale now — a queue event refreshes them all.
    this.events.queueChanged();
    this.logger.warn(
      `Ladder purged by admin ${adminId}: ${result.duels} duels, ${result.ratings} ratings, ${result.queue} queue entries`,
    );
    return result;
  }

  /**
   * Admin asks Valve for the outcome of a FAILED duel right now (same path
   * the worker retries in the background). 409 when the match id is unknown
   * or Valve has no result yet.
   */
  async adminRecoverFromWebApi(
    duelId: string,
    fetchOutcome: (matchId: string) => Promise<number | null>,
  ): Promise<DuelDto> {
    const duel = await this.duels.findOne({ where: { id: duelId } });
    if (!duel) throw new NotFoundException('Duel not found');
    if (!duel.dotaMatchId) {
      throw new ConflictException({
        error: 'no_match_id',
        message: 'У дуелі немає match id — визначте переможця вручну',
      });
    }
    if (duel.ratingAppliedAt) return this.getDuel(duelId, null);
    const outcome = await fetchOutcome(duel.dotaMatchId);
    if (outcome == null) {
      throw new ConflictException({
        error: 'no_outcome_yet',
        message:
          'Valve ще не віддає результат цього матчу — спробуйте за кілька хвилин або визначте переможця вручну',
      });
    }
    await this.applyGcResult(duelId, {
      dotaMatchId: duel.dotaMatchId,
      matchOutcome: outcome,
    });
    this.logger.log(
      `Duel ${duelId} recovered by admin from the Web API: outcome ${outcome}`,
    );
    return this.getDuel(duelId, null);
  }

  async adminSetRating(
    playerId: string,
    rating: number,
  ): Promise<DuelRatingDto> {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');
    const row = await this.ensureRating(playerId);
    row.rating = Math.max(DUEL_RATING_FLOOR, rating);
    await this.ratings.save(row);
    this.events.playersChanged([playerId]);
    return this.toRatingDto(row, playerId);
  }
}

/** Internal: a queued player disappeared between the read and the pairing transaction. */
class QueueRaceError extends Error {}
