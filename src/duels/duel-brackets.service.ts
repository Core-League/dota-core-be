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
import { randomInt, timingSafeEqual } from 'node:crypto';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { NotificationType } from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { Player } from '../players/player.entity';
import { VipService } from '../vip/vip.service';
import {
  DUEL_ACTIVE_STATES,
  DUEL_BRACKET_MAX_TECH_RETRIES,
  DUEL_BRACKET_MIN_PARTICIPANTS,
  DUEL_BRACKET_PRIZE_PLACE_MAX,
  DUEL_PLAYER_CANCELLABLE_STATES,
  DUEL_TERMINAL_STATES,
  DUEL_TOURNAMENT_JOIN_MAX_ATTEMPTS,
  DUEL_TOURNAMENT_JOIN_WINDOW_SECONDS,
  DuelBracketMatchResult,
  DuelBracketMatchStatus,
  DuelBracketSeeding,
  DuelBracketStatus,
  DuelCancelReason,
  DuelFailReason,
  DuelState,
  DuelTournamentPrize,
  DuelTournamentPrizeKind,
  normalizeStreamerLinks,
} from './duel.constants';
import { Duel } from './duel.entity';
import { DuelBracket } from './duel-bracket.entity';
import { DuelBracketMatch } from './duel-bracket-match.entity';
import { DuelBracketParticipant } from './duel-bracket-participant.entity';
import {
  bracketRounds,
  computePlaces,
  firstRoundSeeds,
  hasThirdPlaceMatch,
  slotSource,
} from './duel-bracket.utils';
import { DuelEventsPublisher } from './duel-events.publisher';
import { normalizeDuelPrizes } from './duel-prizes.utils';
import { DuelRating } from './duel-rating.entity';
import { DuelsService } from './duels.service';
import type { DuelDto, DuelPlayerDto } from './dto/duel.dto';
import type {
  CreateDuelBracketDto,
  DuelBracketDto,
  DuelBracketMatchDto,
  DuelBracketParticipantDto,
  DuelBracketSummaryDto,
  UpdateDuelBracketDto,
} from './dto/duel-bracket.dto';
import type { DuelTournamentPrizeInputDto } from './dto/duel-tournament.dto';

/** Duel states in which the lobby (name + password) is worth showing. */
const LOBBY_OPEN_STATES: readonly DuelState[] = [
  DuelState.LOBBY_CREATING,
  DuelState.WAITING_PLAYERS,
  DuelState.LIVE,
];

/** Human-readable reasons a match waits for the organiser. */
const NOTE_BOTH_NO_SHOW = 'Жоден гравець не зайняв слот у лобі';
const NOTE_ADMIN_CANCEL = 'Дуель скасував адміністратор';
const NOTE_TECH_RETRIES = 'Лобі кілька разів не вдалося запустити';
const NOTE_DUEL_MISSING = 'Дуель матчу видалено';
const NOTE_BUSY = 'Чекаємо, поки гравець завершить іншу дуель';
const noteOfFail: Record<DuelFailReason, string> = {
  [DuelFailReason.LOBBY_LOST]: 'Бот втратив лобі — результат невідомий',
  [DuelFailReason.GAME_TIMEOUT]: 'Гра не завершилась вчасно',
  [DuelFailReason.UNDETERMINED_OUTCOME]: 'Не вдалося визначити переможця',
  [DuelFailReason.WRONG_HEROES]: 'Обидва гравці взяли не тих героїв',
};

/** What `advance` did, for the work that must follow the commit. */
interface AdvanceOutcome {
  createdDuels: Array<{
    duelId: string;
    player1Id: string;
    player2Id: string;
  }>;
  finished: boolean;
}

/**
 * Single-elimination 1v1 media tournaments. A streamer (media staff) or an
 * admin creates one, players register (password if set), the organiser
 * launches it and the bracket is generated. Every match whose two players
 * are known becomes a bot-hosted duel of kind `bracket`; when the duel ends,
 * `advance` moves the winner on — driven by the duel events api-v1 hears
 * (`DuelEventsListener`) and a periodic sweep (`DuelBracketsScheduler`).
 *
 * `advance` is idempotent and runs under a row lock on the bracket, so the
 * listener, the sweep and the organiser's actions may race freely.
 */
@Injectable()
export class DuelBracketsService {
  private readonly logger = new Logger(DuelBracketsService.name);
  /** Wrong password attempts per `${bracketId}:${playerId}` (timestamps, ms). */
  private readonly failedJoins = new Map<string, number[]>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(DuelBracket)
    private readonly brackets: Repository<DuelBracket>,
    @InjectRepository(DuelBracketParticipant)
    private readonly participants: Repository<DuelBracketParticipant>,
    @InjectRepository(DuelBracketMatch)
    private readonly matches: Repository<DuelBracketMatch>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Duel) private readonly duels: Repository<Duel>,
    @InjectRepository(DuelRating)
    private readonly ratings: Repository<DuelRating>,
    private readonly duelsService: DuelsService,
    private readonly events: DuelEventsPublisher,
    private readonly vip: VipService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── reads ────────────────────────────────────────────────────────────────

  /** Live first, then open registrations (soonest first), then finished / cancelled (latest first). */
  async list(viewerId: string | null): Promise<DuelBracketSummaryDto[]> {
    const rows = await this.brackets.find({
      relations: ['createdBy'],
      order: { createdAt: 'DESC' },
      take: 100,
    });
    const rank: Record<DuelBracketStatus, number> = {
      [DuelBracketStatus.LIVE]: 0,
      [DuelBracketStatus.REGISTRATION]: 1,
      [DuelBracketStatus.FINISHED]: 2,
      [DuelBracketStatus.CANCELLED]: 3,
    };
    rows.sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) {
        return rank[a.status] - rank[b.status];
      }
      if (a.status === DuelBracketStatus.REGISTRATION) {
        const at = (a.scheduledAt ?? a.createdAt).getTime();
        const bt = (b.scheduledAt ?? b.createdAt).getTime();
        return at - bt;
      }
      const at = (a.finishedAt ?? a.startedAt ?? a.createdAt).getTime();
      const bt = (b.finishedAt ?? b.startedAt ?? b.createdAt).getTime();
      return bt - at;
    });
    return this.toSummaries(rows, viewerId);
  }

  async get(id: string, viewerId: string | null): Promise<DuelBracketDto> {
    const row = await this.findOrThrow(id);
    return this.toDetail(row, viewerId);
  }

  // ── management (organiser or admin) ──────────────────────────────────────

  async create(
    actorId: string,
    body: CreateDuelBracketDto,
  ): Promise<DuelBracketDto> {
    const prizes = this.normalizePrizes(
      body.prizes ?? [],
      [],
      await this.isAdmin(actorId),
    );
    const saved = await this.brackets.save(
      this.brackets.create({
        name: body.name.trim(),
        description: body.description ?? null,
        password: body.password ?? null,
        status: DuelBracketStatus.REGISTRATION,
        maxParticipants: body.maxParticipants,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        streamUrl: body.streamUrl ?? null,
        streamerLinks: normalizeStreamerLinks(body.streamerLinks),
        prizes,
        createdById: actorId,
      }),
    );
    this.logger.log(
      `Bracket "${saved.name}" (${saved.id}) created by ${actorId}: ` +
        `up to ${saved.maxParticipants} players, ${prizes.length} prize place(s)`,
    );
    return this.get(saved.id, actorId);
  }

  async update(
    id: string,
    actorId: string,
    body: UpdateDuelBracketDto,
  ): Promise<DuelBracketDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);
    this.assertNotOver(row);
    const registration = row.status === DuelBracketStatus.REGISTRATION;

    if (body.name != null) row.name = body.name.trim();
    if (body.description !== undefined) row.description = body.description;
    if (body.streamUrl !== undefined) row.streamUrl = body.streamUrl;
    if (body.streamerLinks !== undefined) {
      row.streamerLinks = normalizeStreamerLinks(body.streamerLinks);
    }
    if (body.scheduledAt !== undefined) {
      row.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    }
    if (body.password !== undefined) {
      if (!registration) throw this.registrationClosed();
      row.password = body.password;
    }
    if (body.maxParticipants != null) {
      if (!registration) throw this.registrationClosed();
      const count = await this.participants.count({ where: { bracketId: id } });
      if (body.maxParticipants < count) {
        throw new BadRequestException({
          error: 'bracket_max_below_count',
          message: `Уже зареєстровано ${count} гравців — ліміт не може бути меншим`,
        });
      }
      row.maxParticipants = body.maxParticipants;
    }
    if (body.prizes != null) {
      row.prizes = this.normalizePrizes(
        body.prizes,
        row.prizes ?? [],
        await this.isAdmin(actorId),
      );
    }
    await this.brackets.save(row);
    return this.get(id, actorId);
  }

  /**
   * Generates the bracket from the registered players and starts it: round
   * one gets the seeds (byes to the top seeds), the later rounds are empty
   * nodes filled as results come in, plus the third-place match when the
   * bracket has semi-finals. Ready matches get their duels right away.
   */
  async start(
    id: string,
    actorId: string,
    seeding: DuelBracketSeeding = DuelBracketSeeding.RANDOM,
  ): Promise<DuelBracketDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);

    await this.dataSource.transaction(async (em) => {
      const locked = await em.findOne(DuelBracket, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (locked?.status !== DuelBracketStatus.REGISTRATION) {
        throw new ConflictException({
          error: 'bracket_already_started',
          message: 'Турнір уже запущено або завершено',
        });
      }
      const entrants = await em.find(DuelBracketParticipant, {
        where: { bracketId: id },
      });
      if (entrants.length < DUEL_BRACKET_MIN_PARTICIPANTS) {
        throw new ConflictException({
          error: 'bracket_not_enough_players',
          message: `Для старту потрібно щонайменше ${DUEL_BRACKET_MIN_PARTICIPANTS} гравці`,
        });
      }

      const seeded = await this.seed(em, entrants, seeding);
      const playerOfSeed = new Map(seeded.map((p, ix) => [ix + 1, p]));
      for (const [ix, p] of seeded.entries()) {
        await em.update(
          DuelBracketParticipant,
          { bracketId: id, playerId: p },
          { seed: ix + 1, place: null },
        );
      }

      const rounds = bracketRounds(seeded.length);
      const nodes: Array<Partial<DuelBracketMatch>> = [];
      firstRoundSeeds(seeded.length).forEach(([s1, s2], position) => {
        nodes.push({
          bracketId: id,
          round: 1,
          position,
          player1Id: s1 ? (playerOfSeed.get(s1) ?? null) : null,
          player2Id: s2 ? (playerOfSeed.get(s2) ?? null) : null,
          seed1: s1,
          seed2: s2,
        });
      });
      for (let round = 2; round <= rounds; round++) {
        const count = 2 ** (rounds - round);
        for (let position = 0; position < count; position++) {
          nodes.push({ bracketId: id, round, position });
        }
      }
      if (hasThirdPlaceMatch(rounds)) {
        nodes.push({
          bracketId: id,
          round: rounds,
          position: 1,
          isThirdPlace: true,
        });
      }
      await em.save(
        DuelBracketMatch,
        nodes.map((n) => em.create(DuelBracketMatch, n)),
      );
      await em.update(
        DuelBracket,
        { id },
        {
          status: DuelBracketStatus.LIVE,
          seeding,
          rounds,
          startedAt: new Date(),
        },
      );
      this.logger.log(
        `Bracket "${locked.name}" (${id}) started by ${actorId}: ` +
          `${seeded.length} players, ${rounds} round(s), ${seeding} seeding`,
      );
    });

    await this.advance(id);
    return this.get(id, actorId);
  }

  /**
   * Calls the tournament off: duels that have not started are cancelled,
   * games already running finish but no longer count. Irreversible.
   */
  async cancel(id: string, actorId: string): Promise<DuelBracketDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);
    this.assertNotOver(row);
    const cancelled = await this.dataSource.transaction(async (em) => {
      const locked = await em.findOne(DuelBracket, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !locked ||
        locked.status === DuelBracketStatus.FINISHED ||
        locked.status === DuelBracketStatus.CANCELLED
      ) {
        return [];
      }
      await em.update(
        DuelBracket,
        { id },
        { status: DuelBracketStatus.CANCELLED, finishedAt: new Date() },
      );
      return this.cancelUnstartedDuels(
        em,
        id,
        actorId,
        'bracket cancelled by the organiser',
      );
    });
    this.announceDuels(cancelled);
    this.logger.warn(
      `Bracket "${row.name}" (${id}) cancelled by ${actorId}; ${cancelled.length} unstarted duel(s) cancelled`,
    );
    return this.get(id, actorId);
  }

  /** Admin only: unstarted duels are cancelled, then the bracket goes with its matches. */
  async remove(id: string, adminId: string): Promise<void> {
    const row = await this.findOrThrow(id);
    const cancelled = await this.dataSource.transaction(async (em) => {
      await em.findOne(DuelBracket, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      const ids = await this.cancelUnstartedDuels(
        em,
        id,
        adminId,
        'bracket deleted',
      );
      await em.delete(DuelBracket, { id });
      return ids;
    });
    this.announceDuels(cancelled);
    this.logger.warn(
      `Bracket "${row.name}" (${id}, ${row.status}) deleted by admin ${adminId}; ${cancelled.length} duel(s) cancelled`,
    );
  }

  /** Organiser removes a registered player before the launch. */
  async removeParticipant(
    id: string,
    actorId: string,
    playerId: string,
  ): Promise<DuelBracketDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);
    if (row.status !== DuelBracketStatus.REGISTRATION) {
      throw this.registrationClosed();
    }
    await this.participants.delete({ bracketId: id, playerId });
    return this.get(id, actorId);
  }

  /**
   * Decides a match by hand: a no-show nobody reported, a dispute, a match
   * the bots could not host. Refused while its game is running — the result
   * of a launched game is the bot's call (or an admin's on the duel).
   */
  async setWinner(
    id: string,
    matchId: string,
    actorId: string,
    winnerId: string,
  ): Promise<DuelBracketDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);
    const cancelled = await this.dataSource.transaction(async (em) => {
      await this.lockLiveBracket(em, id);
      const match = await this.lockMatch(em, id, matchId);
      if (match.status === DuelBracketMatchStatus.DONE) {
        throw new ConflictException({
          error: 'bracket_match_done',
          message: 'Матч уже завершено',
        });
      }
      if (!match.player1Id || !match.player2Id) {
        throw new ConflictException({
          error: 'bracket_match_not_ready',
          message: 'У матчі ще немає обох гравців',
        });
      }
      if (winnerId !== match.player1Id && winnerId !== match.player2Id) {
        throw new BadRequestException({
          error: 'bracket_winner_not_player',
          message: 'Переможцем може бути лише один із гравців матчу',
        });
      }
      const cancelledIds: string[] = [];
      if (match.duelId) {
        const duel = await em.findOne(Duel, {
          where: { id: match.duelId },
          lock: { mode: 'pessimistic_write' },
        });
        if (duel && !DUEL_TERMINAL_STATES.includes(duel.state)) {
          if (!DUEL_PLAYER_CANCELLABLE_STATES.includes(duel.state)) {
            throw new ConflictException({
              error: 'bracket_match_running',
              message:
                'Гра вже йде — дочекайтесь результату від бота (або рішення адміна щодо дуелі)',
            });
          }
          this.markDuelCancelled(duel, actorId, 'decided by the organiser');
          await em.save(duel);
          cancelledIds.push(duel.id);
        }
      }
      this.finishMatch(
        match,
        winnerId,
        winnerId === match.player1Id ? match.player2Id : match.player1Id,
        DuelBracketMatchResult.MANUAL,
      );
      await em.save(match);
      this.logger.log(
        `Bracket ${id}: match R${match.round}/${match.position} decided by ${actorId} → ${winnerId}`,
      );
      return cancelledIds;
    });
    this.announceDuels(cancelled);
    await this.advance(id);
    return this.get(id, actorId);
  }

  /** A match waiting for a decision is played again: a fresh duel on the next advance. */
  async replay(
    id: string,
    matchId: string,
    actorId: string,
  ): Promise<DuelBracketDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);
    await this.dataSource.transaction(async (em) => {
      await this.lockLiveBracket(em, id);
      const match = await this.lockMatch(em, id, matchId);
      if (match.status !== DuelBracketMatchStatus.NEEDS_DECISION) {
        throw new ConflictException({
          error: 'bracket_match_not_waiting',
          message: 'Переграти можна лише матч, що чекає на рішення',
        });
      }
      match.status = DuelBracketMatchStatus.READY;
      match.techRetries = 0;
      match.note = null;
      await em.save(match);
    });
    this.logger.log(`Bracket ${id}: match ${matchId} replayed by ${actorId}`);
    await this.advance(id);
    return this.get(id, actorId);
  }

  /**
   * The organiser watches a match: the host bot invites them into the lobby
   * (they take a spectator / broadcaster slot) and does not kick them.
   * Possible until the game launches — then the bot is no longer in the lobby.
   */
  async spectate(
    id: string,
    matchId: string,
    actorId: string,
  ): Promise<DuelBracketMatchDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);
    const match = await this.matches.findOne({
      where: { id: matchId, bracketId: id },
    });
    if (!match) throw new NotFoundException('Матч не знайдено');
    if (match.status !== DuelBracketMatchStatus.LIVE || !match.duelId) {
      throw new ConflictException({
        error: 'bracket_match_no_lobby',
        message: 'Для цього матчу зараз немає лобі',
      });
    }
    const viewer = await this.players.findOne({ where: { id: actorId } });
    if (!viewer?.steamId) {
      throw new ConflictException({
        error: 'steam_not_linked',
        message: 'Прив’яжіть Steam у профілі, щоб бот міг запросити вас у лобі',
      });
    }
    await this.duelsService.addSpectator(match.duelId, {
      playerId: actorId,
      steamId64: viewer.steamId,
    });
    this.logger.log(
      `Bracket ${id}: ${actorId} spectates match ${matchId} (duel ${match.duelId})`,
    );
    const detail = await this.get(id, actorId);
    const dto = detail.matches.find((m) => m.id === matchId);
    if (!dto) throw new NotFoundException('Матч не знайдено');
    return dto;
  }

  // ── players ──────────────────────────────────────────────────────────────

  /** Register; idempotent for players already in. Needs a linked Steam account (the bot invites by it). */
  async join(
    id: string,
    playerId: string,
    password: string | null,
  ): Promise<DuelBracketDto> {
    const row = await this.findOrThrow(id);
    const already = await this.participants.exist({
      where: { bracketId: id, playerId },
    });
    if (already) return this.get(id, playerId);
    if (row.status !== DuelBracketStatus.REGISTRATION) {
      throw this.registrationClosed();
    }
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player?.steamId) {
      throw new ConflictException({
        error: 'steam_not_linked',
        message:
          'Прив’яжіть Steam у профілі — бот запрошує в лобі за Steam-акаунтом',
      });
    }
    if (row.password) this.checkPassword(row, playerId, password);

    const joined = await this.dataSource.transaction(async (em) => {
      await em.findOne(DuelBracket, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      const count = await em.count(DuelBracketParticipant, {
        where: { bracketId: id },
      });
      if (count >= row.maxParticipants) return false;
      await em
        .createQueryBuilder()
        .insert()
        .into(DuelBracketParticipant)
        .values({ bracketId: id, playerId })
        .orIgnore()
        .execute();
      return true;
    });
    if (!joined) {
      throw new ConflictException({
        error: 'bracket_full',
        message: 'Усі місця в турнірі вже зайняті',
      });
    }
    this.logger.log(`Player ${playerId} registered for bracket ${id}`);
    return this.get(id, playerId);
  }

  async leave(id: string, playerId: string): Promise<DuelBracketDto> {
    const row = await this.findOrThrow(id);
    if (row.status !== DuelBracketStatus.REGISTRATION) {
      throw this.registrationClosed();
    }
    await this.participants.delete({ bracketId: id, playerId });
    return this.get(id, playerId);
  }

  // ── engine ───────────────────────────────────────────────────────────────

  /** A duel changed (event from any process): its bracket advances when the duel is over. */
  async onDuelChanged(duelId: string): Promise<void> {
    const duel = await this.duels.findOne({
      where: { id: duelId },
      select: { id: true, state: true, bracketMatchId: true },
    });
    if (!duel?.bracketMatchId || !DUEL_TERMINAL_STATES.includes(duel.state)) {
      return;
    }
    const match = await this.matches.findOne({
      where: { id: duel.bracketMatchId },
      select: { id: true, bracketId: true },
    });
    if (match) await this.advance(match.bracketId);
  }

  /** Scheduler tick: every live bracket advances, finished ones get their prizes settled. */
  async sweep(): Promise<void> {
    const live = await this.brackets.find({
      where: { status: DuelBracketStatus.LIVE },
      select: { id: true },
    });
    for (const b of live) {
      try {
        await this.advance(b.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Bracket ${b.id}: advance failed: ${message}`);
      }
    }
    const unsettled = await this.brackets.find({
      where: { status: DuelBracketStatus.FINISHED, prizesAwardedAt: IsNull() },
      select: { id: true },
      take: 20,
    });
    for (const b of unsettled) await this.settlePrizes(b.id);
  }

  /**
   * Brings a live bracket up to date, in one transaction under its row lock:
   * 1. results of finished duels are written onto their matches;
   * 2. slots are filled from the decided matches of the previous round and
   *    empty slots (byes) decide their matches;
   * 3. ready matches whose players are free get a duel;
   * 4. places are recomputed; the final (and third-place match) decided →
   *    the bracket is FINISHED.
   * Idempotent: running it twice changes nothing the second time.
   */
  async advance(bracketId: string): Promise<void> {
    const outcome = await this.dataSource.transaction(
      async (em): Promise<AdvanceOutcome | null> => {
        const bracket = await em.findOne(DuelBracket, {
          where: { id: bracketId },
          lock: { mode: 'pessimistic_write' },
        });
        if (bracket?.status !== DuelBracketStatus.LIVE) return null;

        const matches = await em.find(DuelBracketMatch, {
          where: { bracketId },
          order: { round: 'ASC', position: 'ASC' },
        });
        const changed = new Set<DuelBracketMatch>();

        await this.syncResults(em, matches, changed);
        this.fillSlots(matches, changed);
        const created = await this.createDuels(em, matches, changed);

        if (changed.size) await em.save([...changed]);

        await this.writePlaces(em, bracket, matches);
        const final = matches.find(
          (m) => m.round === bracket.rounds && !m.isThirdPlace,
        );
        const third = matches.find((m) => m.isThirdPlace);
        const over =
          final?.status === DuelBracketMatchStatus.DONE &&
          (!third || third.status === DuelBracketMatchStatus.DONE);
        if (over) {
          await em.update(
            DuelBracket,
            { id: bracketId },
            {
              status: DuelBracketStatus.FINISHED,
              winnerId: final.winnerId,
              finishedAt: new Date(),
            },
          );
          this.logger.log(
            `Bracket "${bracket.name}" (${bracketId}) finished — champion ${final.winnerId ?? '—'}`,
          );
        }
        return { createdDuels: created, finished: over };
      },
    );
    if (!outcome) return;

    for (const d of outcome.createdDuels) {
      this.events.duelChanged(d.duelId);
      await this.notifyMatchReady(bracketId, d.player1Id, d.player2Id);
    }
    if (outcome.createdDuels.length) this.events.queueChanged();
    if (outcome.finished) await this.settlePrizes(bracketId);
  }

  /** Step 1: terminal duels of LIVE (and waiting) matches decide or reset them. */
  private async syncResults(
    em: EntityManager,
    matches: DuelBracketMatch[],
    changed: Set<DuelBracketMatch>,
  ): Promise<void> {
    const watched = matches.filter(
      (m) =>
        m.duelId &&
        (m.status === DuelBracketMatchStatus.LIVE ||
          m.status === DuelBracketMatchStatus.NEEDS_DECISION),
    );
    if (!watched.length) return;
    const duels = await em.find(Duel, {
      where: { id: In(watched.map((m) => m.duelId as string)) },
    });
    const duelOf = new Map(duels.map((d) => [d.id, d]));

    for (const match of watched) {
      const duel = duelOf.get(match.duelId as string);
      if (match.status === DuelBracketMatchStatus.NEEDS_DECISION) {
        // An admin may still resolve the FAILED duel — its result then counts.
        if (duel?.state === DuelState.RESOLVED && duel.winnerId) {
          this.applyDuelWin(match, duel);
          changed.add(match);
        }
        continue;
      }
      if (!duel) {
        this.needsDecision(match, NOTE_DUEL_MISSING);
        changed.add(match);
        continue;
      }
      if (!DUEL_TERMINAL_STATES.includes(duel.state)) continue;

      if (duel.state === DuelState.RESOLVED && duel.winnerId) {
        this.applyDuelWin(match, duel);
      } else if (duel.state === DuelState.FAILED) {
        this.needsDecision(
          match,
          duel.failReason
            ? noteOfFail[duel.failReason]
            : 'Технічна помилка дуелі',
        );
      } else {
        this.applyCancel(match, duel);
      }
      changed.add(match);
    }
  }

  private applyDuelWin(match: DuelBracketMatch, duel: Duel): void {
    const winnerId = duel.winnerId as string;
    const loserId =
      duel.loserId ??
      (winnerId === match.player1Id ? match.player2Id : match.player1Id);
    const forfeit = duel.error?.startsWith('forfeit:') ?? false;
    this.finishMatch(
      match,
      winnerId,
      loserId,
      forfeit ? DuelBracketMatchResult.FORFEIT : DuelBracketMatchResult.PLAYED,
    );
  }

  /** A cancelled duel: forfeit, another try, or the organiser's call. */
  private applyCancel(match: DuelBracketMatch, duel: Duel): void {
    const other = (loserId: string): string | null =>
      loserId === match.player1Id ? match.player2Id : match.player1Id;
    switch (duel.cancelReason) {
      case DuelCancelReason.PLAYER_CANCELLED:
      case DuelCancelReason.PLAYERS_NO_SHOW:
        if (duel.loserId) {
          this.finishMatch(
            match,
            other(duel.loserId),
            duel.loserId,
            DuelBracketMatchResult.FORFEIT,
          );
        } else {
          this.needsDecision(match, NOTE_BOTH_NO_SHOW);
        }
        return;
      case DuelCancelReason.NO_BOTS_AVAILABLE:
        // Not the players' fault and not a broken lobby — just wait for a bot.
        match.status = DuelBracketMatchStatus.READY;
        return;
      case DuelCancelReason.LOBBY_NOT_CREATED:
      case DuelCancelReason.GAME_ABORTED:
        match.techRetries += 1;
        if (match.techRetries > DUEL_BRACKET_MAX_TECH_RETRIES) {
          this.needsDecision(match, NOTE_TECH_RETRIES);
        } else {
          match.status = DuelBracketMatchStatus.READY;
        }
        return;
      case DuelCancelReason.BRACKET_ORGANISER:
        // Cancelled by `setWinner` / `cancel`, which already settled the match.
        return;
      case DuelCancelReason.ADMIN:
        this.needsDecision(match, NOTE_ADMIN_CANCEL);
        return;
      default:
        this.needsDecision(match, 'Дуель скасовано');
    }
  }

  /** Step 2: slots from the previous round; an empty slot (bye) decides the match. */
  private fillSlots(
    matches: DuelBracketMatch[],
    changed: Set<DuelBracketMatch>,
  ): void {
    const at = new Map(matches.map((m) => [`${m.round}:${m.position}`, m]));
    for (const match of matches) {
      if (
        match.status !== DuelBracketMatchStatus.WAITING &&
        match.status !== DuelBracketMatchStatus.READY
      ) {
        continue;
      }
      // `undefined` — not known yet; `null` — known to stay empty.
      const slots: Array<string | null | undefined> = [
        match.player1Id,
        match.player2Id,
      ];
      if (match.round > 1) {
        for (const slot of [0, 1] as const) {
          const src = slotSource(match, slot);
          const feeder = at.get(`${src.round}:${src.position}`);
          slots[slot] =
            feeder?.status === DuelBracketMatchStatus.DONE
              ? src.takes === 'winner'
                ? feeder.winnerId
                : feeder.loserId
              : undefined;
        }
      }
      const [p1, p2] = slots;
      if (match.round > 1) {
        const next1 = p1 ?? null;
        const next2 = p2 ?? null;
        if (match.player1Id !== next1 || match.player2Id !== next2) {
          match.player1Id = next1;
          match.player2Id = next2;
          changed.add(match);
        }
      }
      if (p1 === undefined || p2 === undefined) continue;
      if (!p1 || !p2) {
        // One or both slots stay empty: the other player goes through.
        this.finishMatch(match, p1 ?? p2, null, DuelBracketMatchResult.BYE);
        changed.add(match);
      } else if (match.status === DuelBracketMatchStatus.WAITING) {
        match.status = DuelBracketMatchStatus.READY;
        changed.add(match);
      }
    }
  }

  /** Step 3: a duel for every ready match whose two players are free right now. */
  private async createDuels(
    em: EntityManager,
    matches: DuelBracketMatch[],
    changed: Set<DuelBracketMatch>,
  ): Promise<AdvanceOutcome['createdDuels']> {
    const ready = matches.filter(
      (m) =>
        m.status === DuelBracketMatchStatus.READY && m.player1Id && m.player2Id,
    );
    if (!ready.length) return [];
    const ids = ready.flatMap((m) => [m.player1Id!, m.player2Id!]);
    const [busyDuels, players] = await Promise.all([
      em.find(Duel, {
        where: [
          { state: In([...DUEL_ACTIVE_STATES]), player1Id: In(ids) },
          { state: In([...DUEL_ACTIVE_STATES]), player2Id: In(ids) },
        ],
        select: { id: true, player1Id: true, player2Id: true },
      }),
      em.find(Player, {
        where: { id: In(ids) },
        select: { id: true, steamId: true, discordName: true },
      }),
    ]);
    const busy = new Set(busyDuels.flatMap((d) => [d.player1Id, d.player2Id]));
    const playerOf = new Map(players.map((p) => [p.id, p]));

    const created: AdvanceOutcome['createdDuels'] = [];
    for (const match of ready) {
      const p1 = match.player1Id!;
      const p2 = match.player2Id!;
      const noSteam = [p1, p2].find((p) => !playerOf.get(p)?.steamId);
      if (noSteam) {
        this.needsDecision(
          match,
          `У гравця ${playerOf.get(noSteam)?.discordName ?? noSteam} не прив’язаний Steam`,
        );
        changed.add(match);
        continue;
      }
      if (busy.has(p1) || busy.has(p2)) {
        if (match.note !== NOTE_BUSY) {
          match.note = NOTE_BUSY;
          changed.add(match);
        }
        continue;
      }
      const duel = await this.duelsService.createBracketDuel(
        em,
        match.id,
        p1,
        p2,
      );
      busy.add(p1);
      busy.add(p2);
      match.duelId = duel.id;
      match.status = DuelBracketMatchStatus.LIVE;
      match.duelsCreated += 1;
      match.note = null;
      changed.add(match);
      created.push({ duelId: duel.id, player1Id: p1, player2Id: p2 });
      this.logger.log(
        `Bracket ${match.bracketId}: match R${match.round}/${match.position} → duel #${duel.number} (${duel.id})`,
      );
    }
    return created;
  }

  /** Step 4: places fixed by the decided matches so far. */
  private async writePlaces(
    em: EntityManager,
    bracket: DuelBracket,
    matches: DuelBracketMatch[],
  ): Promise<void> {
    const places = computePlaces(
      matches.map((m) => ({
        round: m.round,
        position: m.position,
        isThirdPlace: m.isThirdPlace,
        done: m.status === DuelBracketMatchStatus.DONE,
        winnerId: m.winnerId,
        loserId: m.loserId,
      })),
      bracket.rounds,
    );
    if (!places.size) return;
    const rows = await em.find(DuelBracketParticipant, {
      where: { bracketId: bracket.id },
      select: { bracketId: true, playerId: true, place: true },
    });
    for (const row of rows) {
      const place = places.get(row.playerId) ?? null;
      if (place !== row.place) {
        await em.update(
          DuelBracketParticipant,
          { bracketId: bracket.id, playerId: row.playerId },
          { place },
        );
      }
    }
  }

  private finishMatch(
    match: DuelBracketMatch,
    winnerId: string | null,
    loserId: string | null,
    result: DuelBracketMatchResult,
  ): void {
    match.status = DuelBracketMatchStatus.DONE;
    match.winnerId = winnerId;
    match.loserId = loserId;
    match.result = result;
    match.note = null;
    match.finishedAt = new Date();
  }

  private needsDecision(match: DuelBracketMatch, note: string): void {
    match.status = DuelBracketMatchStatus.NEEDS_DECISION;
    match.note = note.slice(0, 160);
  }

  // ── prizes ───────────────────────────────────────────────────────────────

  /**
   * Fixes who won each prize place (the participant on that place) and
   * grants VIP places. Claimed with a conditional update, so it runs once.
   */
  async settlePrizes(id: string): Promise<void> {
    const row = await this.brackets.findOne({ where: { id } });
    if (row?.status !== DuelBracketStatus.FINISHED || row.prizesAwardedAt) {
      return;
    }
    const claim = await this.brackets.update(
      { id, status: DuelBracketStatus.FINISHED, prizesAwardedAt: IsNull() },
      { prizesAwardedAt: new Date() },
    );
    if (!claim.affected || !row.prizes?.length) return;

    const rows = await this.participants.find({ where: { bracketId: id } });
    const holderOf = new Map<number, string>();
    for (const p of rows) {
      if (p.place != null && !holderOf.has(p.place)) {
        holderOf.set(p.place, p.playerId);
      }
    }
    const prizes: DuelTournamentPrize[] = [];
    for (const prize of row.prizes) {
      const winnerId = holderOf.get(prize.place) ?? null;
      prizes.push({ ...prize, awardedPlayerId: winnerId });
      if (!winnerId || prize.kind !== DuelTournamentPrizeKind.VIP) continue;
      try {
        await this.vip.adminGrant(
          winnerId,
          { months: prize.vipMonths ?? 0 },
          `duel-bracket:${id}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Bracket ${id}: VIP for place ${prize.place} (${winnerId}) not granted: ${message}`,
        );
      }
    }
    await this.brackets.update({ id }, { prizes });
    this.logger.log(
      `Bracket "${row.name}" (${id}) prizes settled: ` +
        prizes
          .map((p) => `#${p.place} ${p.kind} → ${p.awardedPlayerId ?? '—'}`)
          .join(', '),
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async findOrThrow(id: string): Promise<DuelBracket> {
    const row = await this.brackets.findOne({
      where: { id },
      relations: ['createdBy'],
    });
    if (!row) throw new NotFoundException('Турнір не знайдено');
    return row;
  }

  private async lockLiveBracket(
    em: EntityManager,
    id: string,
  ): Promise<DuelBracket> {
    const bracket = await em.findOne(DuelBracket, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (bracket?.status !== DuelBracketStatus.LIVE) {
      throw new ConflictException({
        error: 'bracket_not_live',
        message: 'Турнір зараз не триває',
      });
    }
    return bracket;
  }

  private async lockMatch(
    em: EntityManager,
    bracketId: string,
    matchId: string,
  ): Promise<DuelBracketMatch> {
    const match = await em.findOne(DuelBracketMatch, {
      where: { id: matchId, bracketId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!match) throw new NotFoundException('Матч не знайдено');
    return match;
  }

  /** Seeds 1…n: shuffled, or by ladder rating (ties shuffled). */
  private async seed(
    em: EntityManager,
    entrants: DuelBracketParticipant[],
    seeding: DuelBracketSeeding,
  ): Promise<string[]> {
    const ids = entrants.map((e) => e.playerId);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    if (seeding !== DuelBracketSeeding.RATING) return ids;
    const lines = await em.find(DuelRating, {
      where: { playerId: In(ids) },
      select: { playerId: true, rating: true },
    });
    const ratingOf = new Map(lines.map((l) => [l.playerId, l.rating]));
    // Stable sort keeps the shuffle as the tie-break.
    return [...ids].sort(
      (a, b) => (ratingOf.get(b) ?? 0) - (ratingOf.get(a) ?? 0),
    );
  }

  /** Cancels the bracket's duels that have not started; returns their ids. */
  private async cancelUnstartedDuels(
    em: EntityManager,
    bracketId: string,
    actorId: string,
    error: string,
  ): Promise<string[]> {
    const duelIds = (
      await em.find(DuelBracketMatch, {
        where: { bracketId },
        select: { id: true, duelId: true },
      })
    )
      .map((m) => m.duelId)
      .filter((d): d is string => !!d);
    if (!duelIds.length) return [];
    const unstarted = await em.find(Duel, {
      where: {
        id: In(duelIds),
        state: In([...DUEL_PLAYER_CANCELLABLE_STATES]),
      },
      lock: { mode: 'pessimistic_write' },
    });
    for (const duel of unstarted) {
      this.markDuelCancelled(duel, actorId, error);
    }
    if (unstarted.length) await em.save(unstarted);
    return unstarted.map((d) => d.id);
  }

  /** Same fields `DuelsService.cancelDuel` writes; the host bot leaves on its next tick. */
  private markDuelCancelled(duel: Duel, actorId: string, error: string): void {
    duel.state = DuelState.CANCELLED;
    duel.cancelReason = DuelCancelReason.BRACKET_ORGANISER;
    duel.cancelledById = actorId;
    duel.finishedAt = new Date();
    duel.error = error;
  }

  private announceDuels(duelIds: string[]): void {
    for (const duelId of duelIds) this.events.duelChanged(duelId);
  }

  private async notifyMatchReady(
    bracketId: string,
    player1Id: string,
    player2Id: string,
  ): Promise<void> {
    const players = await this.players.find({
      where: { id: In([player1Id, player2Id]) },
    });
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const [me, opponent] of [
      [player1Id, player2Id],
      [player2Id, player1Id],
    ]) {
      try {
        await this.notifications.create({
          playerId: me,
          type: NotificationType.DUEL_BRACKET_MATCH,
          refId: bracketId,
          actor: byId.get(opponent) ?? null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Bracket ${bracketId}: notify ${me} failed: ${message}`,
        );
      }
    }
  }

  private normalizePrizes(
    input: DuelTournamentPrizeInputDto[],
    current: DuelTournamentPrize[],
    isAdmin: boolean,
  ): DuelTournamentPrize[] {
    const tooLow = input.find((p) => p.place > DUEL_BRACKET_PRIZE_PLACE_MAX);
    if (tooLow) {
      throw new BadRequestException({
        error: 'bracket_prize_place',
        message: `Призи можна призначити лише за місця 1–${DUEL_BRACKET_PRIZE_PLACE_MAX}`,
      });
    }
    return normalizeDuelPrizes(input, current, isAdmin);
  }

  private checkPassword(
    row: DuelBracket,
    playerId: string,
    given: string | null,
  ): void {
    const key = `${row.id}:${playerId}`;
    const now = Date.now();
    const recent = (this.failedJoins.get(key) ?? []).filter(
      (t) => now - t < DUEL_TOURNAMENT_JOIN_WINDOW_SECONDS * 1000,
    );
    if (recent.length >= DUEL_TOURNAMENT_JOIN_MAX_ATTEMPTS) {
      throw new HttpException(
        {
          error: 'tournament_join_attempts',
          message: 'Забагато невдалих спроб — спробуйте за кілька хвилин',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const a = Buffer.from(row.password ?? '');
    const b = Buffer.from((given ?? '').trim());
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.failedJoins.set(key, [...recent, now]);
      throw new ForbiddenException({
        error: 'tournament_wrong_password',
        message: 'Невірний пароль турніру',
      });
    }
    this.failedJoins.delete(key);
  }

  private assertNotOver(row: DuelBracket): void {
    if (
      row.status === DuelBracketStatus.FINISHED ||
      row.status === DuelBracketStatus.CANCELLED
    ) {
      throw new ConflictException({
        error: 'bracket_over',
        message: 'Турнір уже завершено',
      });
    }
  }

  private registrationClosed(): ConflictException {
    return new ConflictException({
      error: 'bracket_registration_closed',
      message: 'Реєстрацію закрито — турнір уже стартував',
    });
  }

  private async isAdmin(playerId: string): Promise<boolean> {
    const player = await this.players.findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    return (player?.roles ?? []).some((r) => r.isAdminRole);
  }

  private async assertManager(
    row: DuelBracket,
    actorId: string,
  ): Promise<void> {
    if (row.createdById === actorId || (await this.isAdmin(actorId))) return;
    throw new ForbiddenException({
      error: 'not_tournament_manager',
      message: 'Керувати турніром може лише його організатор або адмін',
    });
  }

  // ── mapping ──────────────────────────────────────────────────────────────

  private async ratingsOf(ids: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.ratings.find({
      where: { playerId: In(unique) },
      select: { playerId: true, rating: true },
    });
    return new Map(rows.map((r) => [r.playerId, r.rating]));
  }

  private card(
    player: Player | null | undefined,
    ratings: Map<string, number>,
  ): DuelPlayerDto | null {
    return player
      ? this.duelsService.toPlayerDto(player, ratings.get(player.id) ?? 0)
      : null;
  }

  private prizeDtos(row: DuelBracket): DuelBracketSummaryDto['prizes'] {
    return (row.prizes ?? []).map((p) => ({
      place: p.place,
      kind: p.kind,
      vipMonths: p.vipMonths ?? null,
      title: p.title ?? null,
      imageUrl: p.imageUrl ?? null,
      linkUrl: p.linkUrl ?? null,
      awardedPlayerId: p.awardedPlayerId ?? null,
    }));
  }

  private async toSummaries(
    rows: DuelBracket[],
    viewerId: string | null,
  ): Promise<DuelBracketSummaryDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const winnerIds = rows
      .map((r) => r.winnerId)
      .filter((w): w is string => !!w);
    const [counts, joinedRows, winners, viewerIsAdmin] = await Promise.all([
      this.participants
        .createQueryBuilder('p')
        .select('p.bracketId', 'bracketId')
        .addSelect('COUNT(*)::int', 'count')
        .where('p.bracketId IN (:...ids)', { ids })
        .groupBy('p.bracketId')
        .getRawMany<{ bracketId: string; count: number }>(),
      viewerId
        ? this.participants.find({
            where: { bracketId: In(ids), playerId: viewerId },
            select: { bracketId: true, playerId: true },
          })
        : Promise.resolve([] as DuelBracketParticipant[]),
      winnerIds.length
        ? this.players.find({ where: { id: In(winnerIds) } })
        : Promise.resolve([] as Player[]),
      viewerId ? this.isAdmin(viewerId) : Promise.resolve(false),
    ]);
    const ratings = await this.ratingsOf([
      ...rows.map((r) => r.createdById).filter((c): c is string => !!c),
      ...winnerIds,
    ]);
    const countOf = new Map(counts.map((c) => [c.bracketId, Number(c.count)]));
    const joined = new Set(joinedRows.map((r) => r.bracketId));
    const winnerOf = new Map(winners.map((w) => [w.id, w]));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      status: row.status,
      maxParticipants: row.maxParticipants,
      participantsCount: countOf.get(row.id) ?? 0,
      hasPassword: !!row.password,
      scheduledAt: row.scheduledAt,
      streamUrl: row.streamUrl ?? null,
      streamerLinks: normalizeStreamerLinks(row.streamerLinks),
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      createdBy: this.card(row.createdBy, ratings),
      winner: row.winnerId
        ? this.card(winnerOf.get(row.winnerId), ratings)
        : null,
      rounds: row.rounds,
      prizes: this.prizeDtos(row),
      joined: joined.has(row.id),
      canManage: !!viewerId && (row.createdById === viewerId || viewerIsAdmin),
    }));
  }

  private async toDetail(
    row: DuelBracket,
    viewerId: string | null,
  ): Promise<DuelBracketDto> {
    const [[summary], entrants, matches, viewer] = await Promise.all([
      this.toSummaries([row], viewerId),
      this.participants.find({
        where: { bracketId: row.id },
        relations: ['player'],
        order: { joinedAt: 'ASC' },
      }),
      this.matches.find({
        where: { bracketId: row.id },
        relations: ['player1', 'player2'],
        order: { round: 'ASC', position: 'ASC' },
      }),
      viewerId
        ? this.players.findOne({
            where: { id: viewerId },
            select: { id: true, steamId: true },
          })
        : Promise.resolve(null),
    ]);
    const ratings = await this.ratingsOf(entrants.map((e) => e.playerId));

    const duelIds = matches
      .map((m) => m.duelId)
      .filter((d): d is string => !!d);
    const duels = duelIds.length
      ? await this.duels.find({
          where: { id: In(duelIds) },
          relations: ['player1', 'player2'],
        })
      : [];
    const duelDtos = await this.duelsService.toDtos(duels, viewerId);
    const duelOf = new Map(
      duels.map((d, ix) => [d.id, { duel: d, dto: duelDtos[ix] }]),
    );

    const launched = row.status !== DuelBracketStatus.REGISTRATION;
    if (launched) {
      entrants.sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999));
    }
    const stillIn = new Set(
      matches
        .filter((m) => m.status !== DuelBracketMatchStatus.DONE)
        .flatMap((m) => [m.player1Id, m.player2Id]),
    );
    const participants: DuelBracketParticipantDto[] = entrants
      .filter((e) => !!e.player)
      .map((e) => ({
        player: this.card(e.player, ratings) as DuelPlayerDto,
        seed: e.seed,
        place: e.place,
        eliminated:
          launched &&
          e.place !== 1 &&
          e.place != null &&
          !stillIn.has(e.playerId),
        joinedAt: e.joinedAt,
      }));

    const matchDtos: DuelBracketMatchDto[] = matches.map((m) => {
      const entry = m.duelId ? duelOf.get(m.duelId) : undefined;
      let duelDto: DuelDto | null = entry?.dto ?? null;
      if (
        entry &&
        summary.canManage &&
        LOBBY_OPEN_STATES.includes(entry.duel.state)
      ) {
        duelDto = { ...entry.dto, lobbyPassword: entry.duel.lobbyPassword };
      }
      return {
        id: m.id,
        round: m.round,
        position: m.position,
        isThirdPlace: m.isThirdPlace,
        status: m.status,
        result: m.result,
        player1: this.card(m.player1, ratings),
        player2: this.card(m.player2, ratings),
        seed1: m.seed1,
        seed2: m.seed2,
        winnerId: m.winnerId,
        loserId: m.loserId,
        note: m.note,
        finishedAt: m.finishedAt,
        duel: duelDto,
        spectating:
          !!viewerId &&
          (entry?.duel.spectators ?? []).some((s) => s.playerId === viewerId),
      };
    });

    const myMatch = viewerId
      ? matches.find(
          (m) =>
            m.status !== DuelBracketMatchStatus.DONE &&
            (m.player1Id === viewerId || m.player2Id === viewerId),
        )
      : undefined;

    return {
      ...summary,
      password: summary.canManage ? row.password : null,
      seeding: row.seeding,
      prizesAwardedAt: row.prizesAwardedAt,
      participants,
      matches: matchDtos,
      myMatchId: myMatch?.id ?? null,
      viewerHasSteam: !!viewer?.steamId,
    };
  }
}
