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
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Player } from '../players/player.entity';
import { VipService } from '../vip/vip.service';
import {
  DUEL_RUNNING_STATES,
  DUEL_PLAYER_CANCELLABLE_STATES,
  DUEL_TOURNAMENT_JOIN_MAX_ATTEMPTS,
  DUEL_TOURNAMENT_JOIN_WINDOW_SECONDS,
  DuelCancelReason,
  DuelTournamentPrize,
  DuelTournamentPrizeKind,
  DuelTournamentStatus,
} from './duel.constants';
import { Duel } from './duel.entity';
import { DuelEventsPublisher } from './duel-events.publisher';
import { normalizeDuelPrizes } from './duel-prizes.utils';
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
 * Password-protected 1v1 stream tournaments: streamers (media staff) or admins
 * create one, hand out the password, players enter it once and then queue in
 * the tournament (pairing and rating live in `DuelMatchmakerService` /
 * `DuelsService`). The organiser and any admin may rename it, change the
 * password or the prizes, or end it; only admins may delete it.
 *
 * Prize places are settled once the tournament is over — ended and none of
 * its games still running: the holders of the places are fixed in
 * `prizes[].awardedPlayerId` and VIP places get their VIP months.
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
    private readonly vip: VipService,
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
    const prizes = normalizeDuelPrizes(
      body.prizes ?? [],
      [],
      await this.isAdmin(actorId),
    );
    const saved = await this.tournaments.save(
      this.tournaments.create({
        name: body.name.trim(),
        password: body.password.trim(),
        status: DuelTournamentStatus.ACTIVE,
        createdById: actorId,
        prizes,
        streamUrl: body.streamUrl ?? null,
      }),
    );
    this.logger.log(
      `Tournament "${saved.name}" (${saved.id}) created by ${actorId}; ${prizes.length} prize place(s)`,
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
    // null / '' (→ null in the DTO) clears the link; absent keeps it.
    if (body.streamUrl !== undefined) row.streamUrl = body.streamUrl;
    if (body.prizes != null) {
      row.prizes = normalizeDuelPrizes(
        body.prizes,
        row.prizes ?? [],
        await this.isAdmin(actorId),
      );
    }
    await this.tournaments.save(row);
    const playerIds = await this.participantIds(id);
    // Duel cards and queue banners show the name.
    this.events.playersChanged(playerIds);
    return this.get(id, actorId);
  }

  /**
   * Freeze the tournament: no joins and no queue from now on, its queue rows
   * go away and duels that have not started yet are cancelled without any
   * rating change. Games already launched finish and still count; the prizes
   * are settled right away when none is running, otherwise by the sweep.
   */
  async end(id: string, actorId: string): Promise<DuelTournamentDto> {
    const row = await this.findOrThrow(id);
    await this.assertManager(row, actorId);
    this.assertActive(row);

    const cancelled = await this.closeTournament(
      id,
      actorId,
      DuelCancelReason.TOURNAMENT_ENDED,
      'tournament ended',
    );
    this.events.queueChanged();
    this.events.playersChanged(await this.participantIds(id));
    this.logger.log(
      `Tournament "${row.name}" (${id}) ended by ${actorId}; ${cancelled} unstarted duel(s) cancelled`,
    );
    await this.settlePrizes(id);
    return this.get(id, actorId);
  }

  /**
   * Admin only. Closes the queue, cancels the duels that have not started and
   * deletes the tournament with its table. Games already running finish
   * without touching any rating (their `tournamentId` turns null — see
   * `DuelsService.ratingLine`); past duels stay in the history.
   */
  async remove(id: string, adminId: string): Promise<void> {
    const row = await this.findOrThrow(id);
    const playerIds = await this.participantIds(id);
    const cancelled = await this.closeTournament(
      id,
      adminId,
      DuelCancelReason.TOURNAMENT_DELETED,
      'tournament deleted',
    );
    await this.tournaments.delete({ id });
    this.events.queueChanged();
    this.events.playersChanged(playerIds);
    this.logger.warn(
      `Tournament "${row.name}" (${id}, ${row.status}) deleted by admin ${adminId}; ` +
        `${cancelled} unstarted duel(s) cancelled, ${playerIds.length} participant(s)`,
    );
  }

  // ── prizes ───────────────────────────────────────────────────────────────

  /** Ended tournaments whose prizes are not settled yet — retried by the sweep. */
  async settleDuePrizes(): Promise<void> {
    const due = await this.tournaments.find({
      where: { status: DuelTournamentStatus.ENDED, prizesAwardedAt: IsNull() },
      select: { id: true },
      take: 20,
    });
    for (const t of due) await this.settlePrizes(t.id);
  }

  /**
   * Fixes the winners of the prize places and grants VIP places, once the
   * tournament is ended and none of its games may still change the table.
   * A place goes to whoever holds it on the final table with at least one
   * played game. Claimed with a conditional update, so it runs exactly once.
   */
  async settlePrizes(id: string): Promise<void> {
    const running = await this.duels.count({
      where: { tournamentId: id, state: In([...DUEL_RUNNING_STATES]) },
    });
    if (running > 0) return;

    const row = await this.tournaments.findOne({ where: { id } });
    if (row?.status !== DuelTournamentStatus.ENDED || row.prizesAwardedAt) {
      return;
    }
    // Read the final table before the claim: a failed read leaves the claim for the next sweep.
    const board = row.prizes?.length
      ? await this.duelsService.getTournamentLeaderboard(id)
      : null;

    const claim = await this.tournaments.update(
      { id, status: DuelTournamentStatus.ENDED, prizesAwardedAt: IsNull() },
      { prizesAwardedAt: new Date() },
    );
    if (!claim.affected || !board) return;

    const holderOf = new Map(
      board.players
        .filter((p) => p.wins + p.losses > 0)
        .map((p) => [p.position, p.player.id]),
    );

    const prizes: DuelTournamentPrize[] = [];
    for (const prize of row.prizes) {
      const winnerId = holderOf.get(prize.place) ?? null;
      prizes.push({ ...prize, awardedPlayerId: winnerId });
      if (!winnerId || prize.kind !== DuelTournamentPrizeKind.VIP) continue;
      try {
        await this.vip.adminGrant(
          winnerId,
          { months: prize.vipMonths ?? 0 },
          `duel-tournament:${id}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Tournament ${id}: VIP for place ${prize.place} (${winnerId}) not granted: ${message}`,
        );
      }
    }
    await this.tournaments.update({ id }, { prizes });
    this.logger.log(
      `Tournament "${row.name}" (${id}) prizes settled: ` +
        prizes
          .map((p) => `#${p.place} ${p.kind} → ${p.awardedPlayerId ?? '—'}`)
          .join(', '),
    );
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

  /**
   * ACTIVE → ENDED (a no-op for an ended one), queue rows dropped, duels that
   * have not started cancelled without rating change. Returns how many were
   * cancelled. The status flip comes first so the matchmaker and the requeue
   * path stop feeding the tournament before its duels are cancelled.
   */
  private async closeTournament(
    id: string,
    actorId: string,
    reason: DuelCancelReason,
    error: string,
  ): Promise<number> {
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
      await this.duelsService.cancelDuel(duel.id, reason, {
        error,
        cancelledById: actorId,
      });
    }
    return unstarted.length;
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
        prizes: (row.prizes ?? []).map((p) => ({
          place: p.place,
          kind: p.kind,
          vipMonths: p.vipMonths ?? null,
          title: p.title ?? null,
          imageUrl: p.imageUrl ?? null,
          linkUrl: p.linkUrl ?? null,
          awardedPlayerId: p.awardedPlayerId ?? null,
        })),
        prizesAwardedAt: row.prizesAwardedAt,
        streamUrl: row.streamUrl ?? null,
      };
    });
  }
}
