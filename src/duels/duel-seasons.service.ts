import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { NotificationType } from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { VipService } from '../vip/vip.service';
import {
  DUEL_PLAYER_CANCELLABLE_STATES,
  DUEL_RUNNING_STATES,
  DUEL_SEASON_FINISH_GRACE_MS,
  DUEL_SEASON_TIME_ZONE,
  DuelCancelReason,
  DuelSeasonPrize,
  DuelSeasonStatus,
  DuelTournamentPrizeKind,
} from './duel.constants';
import { Duel } from './duel.entity';
import { DuelEventsPublisher } from './duel-events.publisher';
import { normalizeDuelPrizes } from './duel-prizes.utils';
import { DuelQueueEntry } from './duel-queue.entity';
import { DuelSeason } from './duel-season.entity';
import { DuelSeasonStanding } from './duel-season-standing.entity';
import { DuelsService } from './duels.service';
import type { DuelLeaderboardDto } from './dto/duel.dto';
import type { DuelSeasonDto } from './dto/duel-season.dto';
import type { DuelTournamentPrizeInputDto } from './dto/duel-tournament.dto';

/**
 * Monthly seasons of the 1v1 ladder (Kyiv calendar months), api-v1 only.
 *
 * The ladder itself stays in `duel_rating`; a season is the window it counts
 * for. When the season's time is up the sweep closes the ladder queue,
 * cancels its duels that have not started, waits for its running games, then
 * in one transaction freezes the table into `duel_season_standing`, resets
 * `duel_rating` and opens the next season (admin prizes carried over).
 * Finally the prize places are settled once: winners fixed, VIP granted,
 * winners notified; custom prizes wait for an admin to mark them issued.
 */
@Injectable()
export class DuelSeasonsService {
  private readonly logger = new Logger(DuelSeasonsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(DuelSeason)
    private readonly seasons: Repository<DuelSeason>,
    @InjectRepository(DuelSeasonStanding)
    private readonly standings: Repository<DuelSeasonStanding>,
    @InjectRepository(Duel) private readonly duels: Repository<Duel>,
    @InjectRepository(DuelQueueEntry)
    private readonly queue: Repository<DuelQueueEntry>,
    private readonly duelsService: DuelsService,
    private readonly vip: VipService,
    private readonly notifications: NotificationsService,
    private readonly events: DuelEventsPublisher,
  ) {}

  // ── reads ────────────────────────────────────────────────────────────────

  /** Every season, newest first. */
  async list(): Promise<DuelSeasonDto[]> {
    const rows = await this.seasons.find({ order: { number: 'DESC' } });
    return this.toDtos(rows);
  }

  async current(): Promise<DuelSeasonDto> {
    const row =
      (await this.duelsService.activeSeason()) ??
      (await this.ensureActiveSeason());
    const [dto] = await this.toDtos([row]);
    return dto;
  }

  async get(id: string): Promise<DuelSeasonDto> {
    const [dto] = await this.toDtos([await this.findOrThrow(id)]);
    return dto;
  }

  /** The live ladder for the active season, the frozen final table for an ended one. */
  async leaderboard(id: string): Promise<DuelLeaderboardDto> {
    const row = await this.findOrThrow(id);
    if (row.status === DuelSeasonStatus.ACTIVE) {
      return this.duelsService.getLeaderboard();
    }
    const lines = await this.standings.find({
      where: { seasonId: id },
      relations: ['player'],
      order: { position: 'ASC' },
    });
    return {
      generatedAt: row.endedAt ?? new Date(),
      players: lines.map((l) => {
        const played = l.wins + l.losses;
        return {
          position: l.position,
          player: this.duelsService.toPlayerDto(l.player, l.rating)!,
          rating: l.rating,
          wins: l.wins,
          losses: l.losses,
          winrate: played > 0 ? Math.round((l.wins * 100) / played) : null,
          streak: l.streak,
          lastPlayedAt: l.lastPlayedAt,
        };
      }),
    };
  }

  // ── admin ────────────────────────────────────────────────────────────────

  /** Replaces the prize places of the active season (admins; VIP allowed). */
  async updatePrizes(
    id: string,
    input: DuelTournamentPrizeInputDto[],
    adminId: string,
  ): Promise<DuelSeasonDto> {
    const row = await this.findOrThrow(id);
    if (row.status !== DuelSeasonStatus.ACTIVE) {
      throw new ConflictException({
        error: 'season_ended',
        message: 'Сезон уже завершено — його призи не змінити',
      });
    }
    const prizes: DuelSeasonPrize[] = normalizeDuelPrizes(
      input,
      row.prizes,
      true,
    ).map((p) => ({ ...p, issuedAt: null, issuedById: null }));
    const saved = await this.seasons.update(
      { id, status: DuelSeasonStatus.ACTIVE },
      { prizes },
    );
    if (!saved.affected) {
      throw new ConflictException({
        error: 'season_ended',
        message: 'Сезон уже завершено — його призи не змінити',
      });
    }
    this.logger.log(
      `Season ${row.number} prizes set by ${adminId}: ` +
        prizes.map((p) => `#${p.place} ${p.kind}`).join(', '),
    );
    return this.get(id);
  }

  /** Marks a won prize place as handed out (or not) — for custom prizes and failed VIP grants. */
  async setPrizeIssued(
    id: string,
    place: number,
    issued: boolean,
    adminId: string,
  ): Promise<DuelSeasonDto> {
    const row = await this.findOrThrow(id);
    if (!row.prizesAwardedAt) {
      throw new ConflictException({
        error: 'season_prizes_not_settled',
        message: 'Переможців сезону ще не визначено',
      });
    }
    const prize = row.prizes.find((p) => p.place === place);
    if (!prize) throw new NotFoundException('Приз за це місце не знайдено');
    if (!prize.awardedPlayerId) {
      throw new ConflictException({
        error: 'season_prize_unawarded',
        message: 'Це місце ніхто не посів — видавати нікому',
      });
    }
    const prizes = row.prizes.map((p) =>
      p.place === place
        ? {
            ...p,
            issuedAt: issued ? new Date().toISOString() : null,
            issuedById: issued ? adminId : null,
          }
        : p,
    );
    await this.seasons.update({ id }, { prizes });
    this.logger.log(
      `Season ${row.number} prize #${place} marked ${issued ? 'issued' : 'not issued'} by ${adminId}`,
    );
    return this.get(id);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Sweep: roll the season over once its time is up; retry unsettled prizes. */
  async sweep(): Promise<void> {
    const active =
      (await this.duelsService.activeSeason()) ??
      (await this.ensureActiveSeason());
    if (DuelsService.isSeasonClosing(active)) await this.rollover(active);

    const due = await this.seasons.find({
      where: { status: DuelSeasonStatus.ENDED, prizesAwardedAt: IsNull() },
      select: { id: true },
      take: 5,
    });
    for (const s of due) await this.settlePrizes(s.id);
  }

  /**
   * Safety net: opens a season for the current Kyiv month when none is
   * active (normally the rollover opens the next one itself). A concurrent
   * call loses on the unique indexes and changes nothing.
   */
  async ensureActiveSeason(): Promise<DuelSeason> {
    await this.dataSource.query(
      `INSERT INTO "duel_season" ("number", "startsAt", "endsAt", "status")
       SELECT s.n,
              date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1,
              (date_trunc('month', now() AT TIME ZONE $1) + interval '1 month') AT TIME ZONE $1,
              'ACTIVE'
         FROM (SELECT COALESCE(MAX("number"), 0) + 1 AS n FROM "duel_season") s
        WHERE NOT EXISTS (SELECT 1 FROM "duel_season" WHERE "status" = 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [DUEL_SEASON_TIME_ZONE],
    );
    const row = await this.duelsService.activeSeason();
    if (!row) throw new Error('No active duel season after ensureActiveSeason');
    return row;
  }

  /**
   * Ends a season whose time is up. Re-entrant: each sweep repeats the
   * closing steps until no game of the season runs any more (or the grace
   * period is over), then the conditional status flip lets exactly one
   * caller freeze the table, reset the ladder and open the next season.
   */
  private async rollover(season: DuelSeason): Promise<void> {
    // 1. Close the ladder: nobody waits in it, nothing new starts.
    const dropped = await this.queue.delete({ tournamentId: IsNull() });
    if (dropped.affected) this.events.queueChanged();
    const unstarted = await this.duels.find({
      where: {
        seasonId: season.id,
        state: In([...DUEL_PLAYER_CANCELLABLE_STATES]),
      },
      select: { id: true },
    });
    for (const duel of unstarted) {
      await this.duelsService.cancelDuel(
        duel.id,
        DuelCancelReason.SEASON_ENDED,
        { error: 'season ended' },
      );
    }

    // 2. Games already launched still count — wait for them (within reason).
    const running = await this.duels.count({
      where: { seasonId: season.id, state: In([...DUEL_RUNNING_STATES]) },
    });
    const graceOver =
      Date.now() >= season.endsAt.getTime() + DUEL_SEASON_FINISH_GRACE_MS;
    if (running > 0 && !graceOver) return;

    // 3. Freeze, reset, open the next season — all or nothing.
    const carried: DuelSeasonPrize[] = season.prizes.map((p) => ({
      ...p,
      awardedPlayerId: null,
      issuedAt: null,
      issuedById: null,
    }));
    const done = await this.dataSource.transaction(async (em) => {
      // Holds back rating writes (bot-worker results) until the season is closed.
      await em.query(`LOCK TABLE "duel_rating" IN SHARE ROW EXCLUSIVE MODE`);
      const claim = await em.update(
        DuelSeason,
        { id: season.id, status: DuelSeasonStatus.ACTIVE },
        { status: DuelSeasonStatus.ENDED, endedAt: new Date() },
      );
      if (!claim.affected) return false;

      // Same order as `DuelsService.getLeaderboard`, plus a stable tie-break.
      await em.query(
        `INSERT INTO "duel_season_standing"
           ("seasonId", "playerId", "position", "rating", "wins", "losses", "streak", "lastPlayedAt")
         SELECT $1::uuid, r."playerId",
                row_number() OVER (
                  ORDER BY r."rating" DESC, r."wins" DESC, r."losses" ASC,
                           r."lastPlayedAt" DESC NULLS LAST, r."playerId" ASC
                ),
                r."rating", r."wins", r."losses", r."streak", r."lastPlayedAt"
           FROM "duel_rating" r
          WHERE r."wins" + r."losses" >= 1
         ON CONFLICT DO NOTHING`,
        [season.id],
      );
      // Everybody starts the new season from the column default (0); queue cooldowns stay.
      await em.query(
        `UPDATE "duel_rating"
            SET "rating" = 0, "wins" = 0, "losses" = 0, "streak" = 0,
                "lastPlayedAt" = NULL, "updatedAt" = now()
          WHERE "rating" <> 0 OR "wins" <> 0 OR "losses" <> 0 OR "streak" <> 0
             OR "lastPlayedAt" IS NOT NULL`,
      );
      // The Kyiv month that holds max(end of this season, now): no chain of empty seasons after a downtime.
      await em.query(
        `INSERT INTO "duel_season" ("number", "startsAt", "endsAt", "status", "prizes")
         SELECT $1::integer,
                date_trunc('month', b.boundary AT TIME ZONE $2) AT TIME ZONE $2,
                (date_trunc('month', b.boundary AT TIME ZONE $2) + interval '1 month') AT TIME ZONE $2,
                'ACTIVE',
                $3::jsonb
           FROM (SELECT GREATEST($4::timestamptz, now()) AS boundary) b`,
        [
          season.number + 1,
          DUEL_SEASON_TIME_ZONE,
          JSON.stringify(carried),
          season.endsAt,
        ],
      );
      return true;
    });
    if (!done) return;

    const playerIds = (
      await this.standings.find({
        where: { seasonId: season.id },
        select: { playerId: true },
      })
    ).map((s) => s.playerId);
    this.logger.log(
      `Season ${season.number} ended: ${playerIds.length} player(s) on the final table, ` +
        `${unstarted.length} unstarted duel(s) cancelled, ${running} still running; season ${season.number + 1} opened`,
    );
    this.events.queueChanged();
    if (playerIds.length) this.events.playersChanged(playerIds);

    await this.settlePrizes(season.id);
  }

  /**
   * Fixes the winners of an ended season's prize places (the final table's
   * holders of those positions) and grants the VIP places. Claimed with a
   * conditional update, so it runs exactly once.
   */
  async settlePrizes(id: string): Promise<void> {
    const row = await this.seasons.findOne({ where: { id } });
    if (row?.status !== DuelSeasonStatus.ENDED || row.prizesAwardedAt) return;
    const claim = await this.seasons.update(
      { id, status: DuelSeasonStatus.ENDED, prizesAwardedAt: IsNull() },
      { prizesAwardedAt: new Date() },
    );
    if (!claim.affected || !row.prizes.length) return;

    const holders = await this.standings.find({
      where: { seasonId: id, position: In(row.prizes.map((p) => p.place)) },
      select: { playerId: true, position: true },
    });
    const holderOf = new Map(holders.map((h) => [h.position, h.playerId]));
    const prizes: DuelSeasonPrize[] = row.prizes.map((p) => ({
      ...p,
      awardedPlayerId: holderOf.get(p.place) ?? null,
      issuedAt: null,
      issuedById: null,
    }));
    // Winners first: even if a grant below fails, admins see who is owed what.
    await this.seasons.update({ id }, { prizes });

    for (const prize of prizes) {
      if (!prize.awardedPlayerId) continue;
      if (prize.kind === DuelTournamentPrizeKind.VIP) {
        try {
          await this.vip.adminGrant(
            prize.awardedPlayerId,
            { months: prize.vipMonths ?? 0 },
            `duel-season:${id}`,
          );
          prize.issuedAt = new Date().toISOString();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Season ${row.number}: VIP for place ${prize.place} (${prize.awardedPlayerId}) not granted: ${message}`,
          );
        }
      }
      await this.notifyWinner(row.number, prize);
    }
    await this.seasons.update({ id }, { prizes });
    this.logger.log(
      `Season ${row.number} prizes settled: ` +
        prizes
          .map(
            (p) =>
              `#${p.place} ${p.kind} → ${p.awardedPlayerId ?? '—'}${p.issuedAt ? ' (issued)' : ''}`,
          )
          .join(', '),
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async notifyWinner(
    seasonNumber: number,
    prize: DuelSeasonPrize,
  ): Promise<void> {
    if (!prize.awardedPlayerId) return;
    const label =
      prize.kind === DuelTournamentPrizeKind.VIP
        ? `VIP на ${prize.vipMonths ?? 0} міс.`
        : (prize.title ?? 'приз від ліги');
    try {
      await this.notifications.create({
        playerId: prize.awardedPlayerId,
        type: NotificationType.DUEL_SEASON_PRIZE,
        payload: {
          seasonPrize: { seasonNumber, place: prize.place, prize: label },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Season ${seasonNumber}: prize notification for ${prize.awardedPlayerId} failed: ${message}`,
      );
    }
  }

  private async findOrThrow(id: string): Promise<DuelSeason> {
    const row = await this.seasons.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Сезон не знайдено');
    return row;
  }

  private async toDtos(rows: DuelSeason[]): Promise<DuelSeasonDto[]> {
    const winnerIds = [
      ...new Set(
        rows.flatMap((r) =>
          r.prizes
            .map((p) => p.awardedPlayerId)
            .filter((pid): pid is string => !!pid),
        ),
      ),
    ];
    // A winner's card comes from their final line (player + final rating).
    const lines = winnerIds.length
      ? await this.standings.find({
          where: {
            seasonId: In(rows.map((r) => r.id)),
            playerId: In(winnerIds),
          },
          relations: ['player'],
        })
      : [];
    const lineOf = new Map(
      lines.map((l) => [`${l.seasonId}:${l.playerId}`, l]),
    );

    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: row.status,
      closing:
        row.status === DuelSeasonStatus.ACTIVE &&
        DuelsService.isSeasonClosing(row),
      endedAt: row.endedAt,
      prizesAwardedAt: row.prizesAwardedAt,
      prizes: row.prizes.map((p) => {
        const line = p.awardedPlayerId
          ? lineOf.get(`${row.id}:${p.awardedPlayerId}`)
          : undefined;
        return {
          place: p.place,
          kind: p.kind,
          vipMonths: p.vipMonths,
          title: p.title,
          imageUrl: p.imageUrl,
          linkUrl: p.linkUrl,
          awardedPlayerId: p.awardedPlayerId,
          awardedPlayer: line
            ? this.duelsService.toPlayerDto(line.player, line.rating)
            : null,
          issuedAt: p.issuedAt ?? null,
        };
      }),
    }));
  }
}
