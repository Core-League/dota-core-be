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
  Repository,
} from 'typeorm';
import { Player } from '../players/player.entity';
import {
  DUEL_ACCEPT_WINDOW_SECONDS,
  DUEL_ACTIVE_STATES,
  DUEL_CANCEL_PENALTY,
  DUEL_JOIN_TIMEOUT_SECONDS,
  DUEL_NO_SHOW_COOLDOWN_SECONDS,
  DUEL_PLAYER_CANCELLABLE_STATES,
  DUEL_QUEUE_WINDOW_BASE,
  DUEL_QUEUE_WINDOW_STEP,
  DUEL_QUEUE_WINDOW_STEP_SECONDS,
  DUEL_RATING_DELTA,
  DUEL_RATING_FLOOR,
  DUEL_TERMINAL_STATES,
  DuelCancelReason,
  DuelFailReason,
  DuelState,
  MATCH_OUTCOME_DIRE,
  MATCH_OUTCOME_RADIANT,
  type DuelLobbyPlayer,
  type DuelStats,
} from './duel.constants';
import { Duel } from './duel.entity';
import { heroById, pickRandomHeroes } from './dota-heroes';
import { DuelQueueEntry } from './duel-queue.entity';
import { DuelRating } from './duel-rating.entity';
import { HostBot } from './host-bot.entity';
import { HostBotsService } from './host-bots.service';
import { AdminPurgeDuelsResultDto } from './dto/duel-admin.dto';
import {
  DuelBotsStatusDto,
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
    private readonly hostBots: HostBotsService,
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

  private toPlayerDto(
    player: Player | null,
    ratings: Map<string, DuelRating>,
  ): DuelPlayerDto | null {
    if (!player) return null;
    return {
      id: player.id,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      avatarUrl: player.avatarUrl ?? null,
      steamId: player.steamId ?? null,
      rating: ratings.get(player.id)?.rating ?? 0,
    };
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
    ratings: Map<string, DuelRating>,
    viewerId: string | null,
  ): DuelDto {
    const isParticipant =
      viewerId != null &&
      (duel.player1Id === viewerId || duel.player2Id === viewerId);
    const showPassword = isParticipant && this.isLobbyOpen(duel.state);
    return {
      id: duel.id,
      state: duel.state,
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
      player1: this.toPlayerDto(duel.player1, ratings),
      player2: this.toPlayerDto(duel.player2, ratings),
      player1Rating: duel.player1Rating,
      player2Rating: duel.player2Rating,
      lobbyName: duel.lobbyName,
      lobbyPassword: showPassword ? duel.lobbyPassword : null,
      heroes: duel.heroes ? duel.heroes.map((h) => this.toHeroDto(h)) : null,
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
      stats: duel.stats,
    };
  }

  private async ratingsFor(duels: Duel[]): Promise<Map<string, DuelRating>> {
    const ids = new Set<string>();
    for (const d of duels) {
      if (d.player1Id) ids.add(d.player1Id);
      if (d.player2Id) ids.add(d.player2Id);
    }
    if (!ids.size) return new Map();
    const rows = await this.ratings.find({
      where: { playerId: In([...ids]) },
    });
    return new Map(rows.map((r) => [r.playerId, r]));
  }

  async toDtos(duels: Duel[], viewerId: string | null): Promise<DuelDto[]> {
    const ratings = await this.ratingsFor(duels);
    return duels.map((d) => this.toDuelDto(d, ratings, viewerId));
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

  private findLastFinishedDuelForPlayer(
    playerId: string,
  ): Promise<Duel | null> {
    return this.duels.findOne({
      where: [
        { player1Id: playerId, state: In([...DUEL_TERMINAL_STATES]) },
        { player2Id: playerId, state: In([...DUEL_TERMINAL_STATES]) },
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

  async joinQueue(playerId: string): Promise<DuelStatusDto> {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');
    const rating = await this.ensureRating(playerId);
    const queued = (await this.queue.findOne({ where: { playerId } })) != null;
    const bots = await this.hostBots.publicStatus();
    const blocked = await this.queueBlockedReason(player, rating, queued, bots);
    if (blocked === DuelQueueBlockedReason.STEAM_NOT_LINKED) {
      throw new BadRequestException({
        error: blocked,
        message: 'Прив’яжіть Steam-акаунт у профілі, щоб грати 1v1',
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
    await this.queue
      .createQueryBuilder()
      .insert()
      .into(DuelQueueEntry)
      .values({
        playerId,
        rating: rating.rating,
        joinedAt: now,
        lastSeenAt: now,
      })
      .orIgnore()
      .execute();
    return this.getStatus(playerId);
  }

  async leaveQueue(playerId: string): Promise<DuelStatusDto> {
    await this.queue.delete({ playerId });
    return this.getStatus(playerId);
  }

  /** Page snapshot. Also the queue heartbeat: refreshes `lastSeenAt`. */
  async getStatus(playerId: string): Promise<DuelStatusDto> {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');

    const now = new Date();
    await this.queue.update({ playerId }, { lastSeenAt: now });
    const [entry, playersInQueue, rating, active, lastFinished, bots] =
      await Promise.all([
        this.queue.findOne({ where: { playerId } }),
        this.queue.count(),
        this.ratings.findOne({ where: { playerId } }),
        this.findActiveDuelForPlayer(playerId),
        this.findLastFinishedDuelForPlayer(playerId),
        this.hostBots.publicStatus(),
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

    return {
      rating: this.toRatingDto(rating, playerId),
      queue: entry
        ? {
            joinedAt: entry.joinedAt,
            waitSeconds,
            window: DuelsService.queueWindow(waitSeconds),
            playersInQueue,
          }
        : null,
      activeDuel: activeDto,
      lastFinishedDuel: lastFinishedDto,
      canQueue: blocked == null,
      queueBlockedReason: blocked,
      bots,
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

  /** −points (floor 0) and an optional queue cooldown for a player who bailed on a found match. */
  private async applyPenalty(
    em: EntityManager,
    playerId: string,
    points: number,
    cooldownUntil: Date | null,
  ): Promise<void> {
    const row = await this.ensureRating(playerId, em);
    row.rating = Math.max(DUEL_RATING_FLOOR, row.rating - points);
    if (cooldownUntil) row.cooldownUntil = cooldownUntil;
    await em.save(row);
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
      await this.applyPenalty(em, playerId, DUEL_CANCEL_PENALTY, null);
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
    this.logger.log(
      `Duel ${duelId} cancelled by player ${playerId} (−${DUEL_CANCEL_PENALTY})`,
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
    return this.dataSource
      .transaction(async (em) => {
        const removed = await em.delete(DuelQueueEntry, {
          playerId: In([p1.playerId, p2.playerId]),
        });
        if ((removed.affected ?? 0) !== 2) {
          throw new QueueRaceError();
        }
        const duel = em.create(Duel, {
          state: DuelState.ACCEPTING,
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
  }

  /**
   * Puts the duel's players back into the queue (after `no_bots_available`,
   * a cancel by the other side, …). `only` limits it to a subset.
   */
  async requeuePlayers(
    duel: Duel,
    em: EntityManager,
    only?: string[],
  ): Promise<void> {
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
      .values(values.map((v) => ({ ...v, joinedAt: now, lastSeenAt: now })))
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
    return this.findDuelEntity(id);
  }

  /** Reverts a claimed duel to PENDING (bot could not create the lobby right away but is still healthy). */
  async releaseClaim(duelId: string): Promise<void> {
    await this.duels.update(
      { id: duelId, state: DuelState.LOBBY_CREATING },
      { hostBotId: null, state: DuelState.PENDING },
    );
  }

  async markLobbyReady(duelId: string, lobbyId: string): Promise<void> {
    await this.duels.update(
      { id: duelId },
      { lobbyId, state: DuelState.WAITING_PLAYERS, lobbyReadyAt: new Date() },
    );
  }

  async updateLobbyPlayers(
    duelId: string,
    players: DuelLobbyPlayer[],
  ): Promise<void> {
    await this.duels.update({ id: duelId }, { lobbyPlayers: players });
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
  }

  /** Valve match id becomes known at launch; stored early so a restarted worker can still resolve the game. */
  async saveMatchId(duelId: string, dotaMatchId: string): Promise<void> {
    await this.duels.update(
      { id: duelId, dotaMatchId: IsNull() },
      { dotaMatchId },
    );
  }

  async saveStats(duelId: string, stats: DuelStats): Promise<void> {
    await this.duels.update({ id: duelId }, { stats });
  }

  /**
   * Final result from the Game Coordinator. Applies ±25 to both ladder lines
   * in one transaction; idempotent (a second call for the same duel is a no-op).
   * An outcome that names neither side leaves the duel FAILED for an admin.
   */
  async applyGcResult(duelId: string, result: DuelGcResult): Promise<Duel> {
    return this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) throw new NotFoundException('Duel not found');
      if (duel.ratingAppliedAt) return duel;

      duel.dotaMatchId = result.dotaMatchId;
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
      return em.save(duel);
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
    const winner = await this.ensureRating(winnerId, em);
    const loser = await this.ensureRating(loserId, em);

    winner.rating += DUEL_RATING_DELTA;
    winner.wins += 1;
    winner.streak = winner.streak > 0 ? winner.streak + 1 : 1;
    winner.lastPlayedAt = now;

    loser.rating = Math.max(
      DUEL_RATING_FLOOR,
      loser.rating - DUEL_RATING_DELTA,
    );
    loser.losses += 1;
    loser.streak = loser.streak < 0 ? loser.streak - 1 : -1;
    loser.lastPlayedAt = now;

    await em.save([winner, loser]);

    duel.state = DuelState.RESOLVED;
    duel.winnerId = winnerId;
    duel.loserId = loserId;
    duel.ratingDelta = DUEL_RATING_DELTA;
    duel.ratingAppliedAt = now;
    duel.finishedAt = duel.finishedAt ?? now;
    duel.adminReviewRequired = false;
    duel.resolvedByAdminId = adminId;
    if (!duel.error?.startsWith('forfeit:')) duel.error = null;
  }

  /**
   * Nobody (or only one player) showed up. The absent player loses 25 points
   * (floor 0) and gets a queue cooldown; the present player is untouched.
   * A no-show is not a played game, so wins/losses stay as they were.
   */
  async applyNoShow(duelId: string, absentPlayerIds: string[]): Promise<Duel> {
    return this.dataSource.transaction(async (em) => {
      const duel = await em.findOne(Duel, {
        where: { id: duelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!duel) throw new NotFoundException('Duel not found');
      if (DUEL_TERMINAL_STATES.includes(duel.state)) return duel;

      const now = new Date();
      const cooldownUntil = new Date(
        now.getTime() + DUEL_NO_SHOW_COOLDOWN_SECONDS * 1000,
      );
      for (const playerId of absentPlayerIds) {
        const row = await this.ensureRating(playerId, em);
        row.rating = Math.max(
          DUEL_RATING_FLOOR,
          row.rating - DUEL_RATING_DELTA,
        );
        row.cooldownUntil = cooldownUntil;
        await em.save(row);
      }
      duel.state = DuelState.CANCELLED;
      duel.cancelReason = DuelCancelReason.PLAYERS_NO_SHOW;
      duel.ratingDelta = absentPlayerIds.length ? DUEL_RATING_DELTA : null;
      duel.ratingAppliedAt = absentPlayerIds.length ? now : null;
      duel.finishedAt = now;
      duel.error = absentPlayerIds.length
        ? `no-show: ${absentPlayerIds.join(', ')}`
        : 'no-show: both';
      return em.save(duel);
    });
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
    return this.dataSource.transaction(async (em) => {
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
      } else if (opts.requeue) {
        await this.requeuePlayers(saved, em);
      }
      return saved;
    });
  }

  async failDuel(
    duelId: string,
    reason: DuelFailReason,
    error?: string,
  ): Promise<Duel | null> {
    return this.dataSource.transaction(async (em) => {
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
  }

  /** Current state only — the worker polls this each tick to notice admin cancels. */
  async getState(duelId: string): Promise<DuelState | null> {
    const row = await this.duels.findOne({
      where: { id: duelId },
      select: { id: true, state: true },
    });
    return row?.state ?? null;
  }

  /** Every duel a bot claimed that has not finished — what a restarted worker must reconcile. */
  findActiveClaimedDuels(): Promise<Duel[]> {
    return this.duels.find({
      where: {
        state: In([
          DuelState.LOBBY_CREATING,
          DuelState.WAITING_PLAYERS,
          DuelState.LIVE,
        ]),
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
    const ratings = new Map(rows.map((r) => [r.playerId, r]));
    return {
      generatedAt: new Date(),
      players: rows.map((r, index) => {
        const played = r.wins + r.losses;
        return {
          position: index + 1,
          player: this.toPlayerDto(r.player, ratings)!,
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
  ): Promise<DuelDto[]> {
    const rows = await this.duels.find({
      where: state ? { state } : {},
      relations: ['player1', 'player2'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return this.toDtos(rows, null);
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
    this.logger.warn(
      `Ladder purged by admin ${adminId}: ${result.duels} duels, ${result.ratings} ratings, ${result.queue} queue entries`,
    );
    return result;
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
    return this.toRatingDto(row, playerId);
  }
}

/** Internal: a queued player disappeared between the read and the pairing transaction. */
class QueueRaceError extends Error {}
