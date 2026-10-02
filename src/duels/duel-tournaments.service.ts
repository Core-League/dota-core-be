import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import {
  DUEL_PLAYER_CANCELLABLE_STATES,
  DUEL_TOURNAMENT_JOIN_MAX_ATTEMPTS,
  DUEL_TOURNAMENT_JOIN_WINDOW_SECONDS,
  DuelCancelReason,
  DuelTournamentStatus,
} from './duel.constants';
import { Duel } from './duel.entity';
import { DuelEventsPublisher } from './duel-events.publisher';
import { DuelQueueEntry } from './duel-queue.entity';
import { DuelRating } from './duel-rating.entity';
import { DuelTournament } from './duel-tournament.entity';
import { DuelTournamentParticipant } from './duel-tournament-participant.entity';
import { DuelsService } from './duels.service';
import type { DuelLeaderboardDto } from './dto/duel.dto';
import type {
  CreateDuelTournamentDto,
  DuelTournamentDto,
  UpdateDuelTournamentDto,
} from './dto/duel-tournament.dto';

/**
 * Password-protected 1v1 tournaments: media staff or admins create one, hand
 * out the password, players enter it once and then queue in the tournament
 * (pairing and rating live in `DuelMatchmakerService` / `DuelsService`).
 * The organiser and any admin may rename it, change the password or end it.
 */
@Injectable()
export class DuelTournamentsService {
  private readonly logger = new Logger(DuelTournamentsService.name);
  /** Wrong password attempts per `${tournamentId}:${playerId}` (timestamps, ms). */
  private readonly failedJoins = new Map<string, number[]>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(DuelTournament)
    private readonly tournaments: Repository<DuelTournament>,
    @InjectRepository(DuelTournamentParticipant)
    private readonly participants: Repository<DuelTournamentParticipant>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Duel) private readonly duels: Repository<Duel>,
    @InjectRepository(DuelRating)
    private readonly ratings: Repository<DuelRating>,
    private readonly duelsService: DuelsService,
    private readonly events: DuelEventsPublisher,
  ) {}

  // ── reads ────────────────────────────────────────────────────────────────

  /** Active tournaments first (newest first), then ended ones (latest ended first). */
  async list(viewerId: string | null): Promise<DuelTournamentDto[]> {
    const rows = await this.tournaments.find({
      relations: ['createdBy'],
      order: { createdAt: 'DESC' },
      take: 100,
    });
    rows.sort((a, b) => {
      const aActive = a.status === DuelTournamentStatus.ACTIVE ? 0 : 1;
      const bActive = b.status === DuelTournamentStatus.ACTIVE ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aTime = (a.endedAt ?? a.createdAt).getTime();
      const bTime = (b.endedAt ?? b.createdAt).getTime();
      return bTime - aTime;
    });
    return this.toDtos(rows, viewerId, false);
  }

  async get(id: string, viewerId: string | null): Promise<DuelTournamentDto> {
    const row = await this.findOrThrow(id);
    const [dto] = await this.toDtos([row], viewerId, true);
    return dto;
  }

  async leaderboard(id: string): Promise<DuelLeaderboardDto> {
    await this.findOrThrow(id);
    return this.duelsService.getTournamentLeaderboard(id);
  }

  // ── management (organiser or admin) ──────────────────────────────────────

  async create(
    actorId: string,
    body: CreateDuelTournamentDto,
  ): Promise<DuelTournamentDto> {
    const saved = await this.tournaments.save(
      this.tournaments.create({
        name: body.name.trim(),
        password: body.password.trim(),
        status: DuelTournamentStatus.ACTIVE,
        createdById: actorId,
      }),
    );
    this.logger.log(
      `Tournament "${saved.name}" (${saved.id}) created by ${actorId}`,
    );
    return this.get(saved.id, actorId);
  }

  async update(
    id: string,
    actorId: string,
    body: UpdateDuelTournamentDto,
  ): Promise<DuelTournamentDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);
    this.assertActive(row);
    if (body.name != null) row.name = body.name.trim();
    if (body.password != null) row.password = body.password.trim();
    await this.tournaments.save(row);
    const playerIds = await this.participantIds(id);
    // Duel cards and queue banners show the name.
    this.events.playersChanged(playerIds);
    return this.get(id, actorId);
  }

  /**
   * Freeze the tournament: no joins and no queue from now on, its queue rows
   * go away and duels that have not started yet are cancelled without any
   * rating change. Games already launched finish and still count.
   */
  async end(id: string, actorId: string): Promise<DuelTournamentDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);
    this.assertActive(row);

    await this.dataSource.transaction(async (em) => {
      await em.update(
        DuelTournament,
        { id, status: DuelTournamentStatus.ACTIVE },
        {
          status: DuelTournamentStatus.ENDED,
          endedAt: new Date(),
          endedById: actorId,
        },
      );
      await em.delete(DuelQueueEntry, { tournamentId: id });
    });

    const unstarted = await this.duels.find({
      where: {
        tournamentId: id,
        state: In([...DUEL_PLAYER_CANCELLABLE_STATES]),
      },
      select: { id: true },
    });
    for (const duel of unstarted) {
      await this.duelsService.cancelDuel(
        duel.id,
        DuelCancelReason.TOURNAMENT_ENDED,
        { error: 'tournament ended', cancelledById: actorId },
      );
    }

    this.events.queueChanged();
    this.events.playersChanged(await this.participantIds(id));
    this.logger.log(
      `Tournament "${row.name}" (${id}) ended by ${actorId}; ${unstarted.length} unstarted duel(s) cancelled`,
    );
    return this.get(id, actorId);
  }

  // ── players ──────────────────────────────────────────────────────────────

  /** Enter the password once; idempotent for players who already joined. */
  async join(
    id: string,
    playerId: string,
    password: string,
  ): Promise<DuelTournamentDto> {
    const row = await this.findOrThrow(id);
    const already = await this.participants.exist({
      where: { tournamentId: id, playerId },
    });
    if (already) return this.get(id, playerId);
    this.assertActive(row);

    const key = `${id}:${playerId}`;
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
    if (!this.passwordMatches(row.password, password.trim())) {
      this.failedJoins.set(key, [...recent, now]);
      throw new ForbiddenException({
        error: 'tournament_wrong_password',
        message: 'Невірний пароль турніру',
      });
    }
    this.failedJoins.delete(key);

    await this.participants
      .createQueryBuilder()
      .insert()
      .into(DuelTournamentParticipant)
      .values({ tournamentId: id, playerId })
      .orIgnore()
      .execute();
    this.events.playersChanged([playerId]);
    this.logger.log(`Player ${playerId} joined tournament ${id}`);
    return this.get(id, playerId);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async findOrThrow(id: string): Promise<DuelTournament> {
    const row = await this.tournaments.findOne({
      where: { id },
      relations: ['createdBy'],
    });
    if (!row) throw new NotFoundException('Турнір не знайдено');
    return row;
  }

  private assertActive(row: DuelTournament): void {
    if (row.status !== DuelTournamentStatus.ACTIVE) {
      throw new ConflictException({
        error: 'tournament_ended',
        message: 'Турнір уже завершено',
      });
    }
  }

  private async isAdmin(playerId: string): Promise<boolean> {
    const player = await this.players.findOne({
      where: { id: playerId },
      relations: ['roles'],
    });
    return (player?.roles ?? []).some((r) => r.isAdminRole);
  }

  private async canManage(
    row: DuelTournament,
    viewerId: string | null,
  ): Promise<boolean> {
    if (!viewerId) return false;
    if (row.createdById === viewerId) return true;
    return this.isAdmin(viewerId);
  }

  private async assertManager(
    row: DuelTournament,
    actorId: string,
  ): Promise<void> {
    if (!(await this.canManage(row, actorId))) {
      throw new ForbiddenException({
        error: 'not_tournament_manager',
        message: 'Керувати турніром може лише його організатор або адмін',
      });
    }
  }

  private passwordMatches(expected: string, given: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async participantIds(tournamentId: string): Promise<string[]> {
    const rows = await this.participants.find({
      where: { tournamentId },
      select: { tournamentId: true, playerId: true },
    });
    return rows.map((r) => r.playerId);
  }

  private async toDtos(
    rows: DuelTournament[],
    viewerId: string | null,
    withPassword: boolean,
  ): Promise<DuelTournamentDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const creatorIds = rows
      .map((r) => r.createdById)
      .filter((id): id is string => !!id);

    const [counts, joinedRows, creatorRatings, viewerIsAdmin] =
      await Promise.all([
        this.participants
          .createQueryBuilder('t')
          .select('t.tournamentId', 'tournamentId')
          .addSelect('COUNT(*)::int', 'count')
          .where('t.tournamentId IN (:...ids)', { ids })
          .groupBy('t.tournamentId')
          .getRawMany<{ tournamentId: string; count: number }>(),
        viewerId
          ? this.participants.find({
              where: { tournamentId: In(ids), playerId: viewerId },
              select: { tournamentId: true, playerId: true },
            })
          : Promise.resolve([] as DuelTournamentParticipant[]),
        creatorIds.length
          ? this.ratings.find({ where: { playerId: In(creatorIds) } })
          : Promise.resolve([] as DuelRating[]),
        viewerId ? this.isAdmin(viewerId) : Promise.resolve(false),
      ]);

    const countOf = new Map(
      counts.map((c) => [c.tournamentId, Number(c.count)]),
    );
    const joined = new Set(joinedRows.map((r) => r.tournamentId));
    const ratingOf = new Map(creatorRatings.map((r) => [r.playerId, r.rating]));

    return rows.map((row) => {
      const canManage =
        !!viewerId && (row.createdById === viewerId || viewerIsAdmin);
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt,
        endedAt: row.endedAt,
        createdBy: this.duelsService.toPlayerDto(
          row.createdBy,
          row.createdById ? (ratingOf.get(row.createdById) ?? 0) : 0,
        ),
        participantsCount: countOf.get(row.id) ?? 0,
        joined: joined.has(row.id),
        canManage,
        password: withPassword && canManage ? row.password : null,
      };
    });
  }
}
