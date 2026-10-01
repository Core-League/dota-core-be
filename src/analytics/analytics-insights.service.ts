import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DuelState } from '../duels/duel.constants';
import { PaymentStatus } from '../tournaments/tournament-team-payment.model';
import { VIP_LIFETIME_UNTIL, VipPaymentStatus } from '../vip/vip.constants';
import {
  AnalyticsDuelActivityDto,
  AnalyticsInsightsDto,
  AnalyticsRevenueDto,
  AnalyticsRosterDto,
  AnalyticsVipDto,
  RevenueBySourceDto,
  RevenueMonthDto,
} from './dto/analytics-insights.dto';

const TIME_ZONE = 'Europe/Kyiv';
const POSITIONS = [1, 2, 3, 4, 5] as const;
const REVENUE_MONTHS = 6;
const DUEL_DAYS = 30;
const VIP_EXPIRING_DAYS = 7;

type TRevenueSource = keyof RevenueBySourceDto;

/**
 * Players counted by the roster block (rating above 0, same as the overview)
 * with an `inTeam` flag: main, reserve or captain of a team that is not
 * disbanded. `player.teamId` is not used — it may hold an external team id.
 */
const ROSTER_BASE_SQL = `
  WITH rostered AS (
    SELECT m."playerId" FROM "team_main_players" m
      JOIN "team" t ON t."id" = m."teamId" WHERE t."disbandedAt" IS NULL
    UNION
    SELECT r."playerId" FROM "team_reserved_players" r
      JOIN "team" t ON t."id" = r."teamId" WHERE t."disbandedAt" IS NULL
    UNION
    SELECT t."captainId" FROM "team" t WHERE t."disbandedAt" IS NULL
  ),
  base AS (
    SELECT p."id", p."steamId", p."telegramId", p."positions",
           (rs."playerId" IS NOT NULL) AS "inTeam"
      FROM "player" p
      LEFT JOIN rostered rs ON rs."playerId" = p."id"
     WHERE p."rating" > 0
  )`;

/**
 * Secondary admin dashboard numbers that the overview does not carry:
 * recruiting pool, money in, VIP subscribers and duel activity over time.
 * Read-only aggregates — one round trip per block.
 */
@Injectable()
export class AnalyticsInsightsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getInsights(): Promise<AnalyticsInsightsDto> {
    const [roster, revenue, vip, duelActivity] = await Promise.all([
      this.loadRoster(),
      this.loadRevenue(),
      this.loadVip(),
      this.loadDuelActivity(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      roster,
      revenue,
      vip,
      duelActivity,
    };
  }

  private async loadRoster(): Promise<AnalyticsRosterDto> {
    const [summaryRows, positionRows] = await Promise.all([
      this.dataSource.query<
        Array<{
          players: number;
          inTeam: number;
          steamLinked: number;
          telegramLinked: number;
          withPositions: number;
        }>
      >(
        `${ROSTER_BASE_SQL}
        SELECT COUNT(*)::int AS "players",
               COUNT(*) FILTER (WHERE "inTeam")::int AS "inTeam",
               COUNT(*) FILTER (WHERE "steamId" IS NOT NULL)::int AS "steamLinked",
               COUNT(*) FILTER (WHERE "telegramId" IS NOT NULL)::int AS "telegramLinked",
               COUNT(*) FILTER (WHERE cardinality("positions") > 0)::int AS "withPositions"
          FROM base`,
      ),
      this.dataSource.query<
        Array<{ position: number; players: number; freeAgents: number }>
      >(
        `${ROSTER_BASE_SQL}
        SELECT u.pos::int AS "position",
               COUNT(DISTINCT b."id")::int AS "players",
               COUNT(DISTINCT b."id") FILTER (WHERE NOT b."inTeam")::int AS "freeAgents"
          FROM base b, unnest(b."positions") AS u(pos)
         GROUP BY u.pos`,
      ),
    ]);

    const summary = summaryRows[0];
    const players = Number(summary?.players ?? 0);
    const inTeam = Number(summary?.inTeam ?? 0);
    const byPosition = new Map(
      positionRows.map((row) => [Number(row.position), row]),
    );

    return {
      players,
      inTeam,
      freeAgents: players - inTeam,
      steamLinked: Number(summary?.steamLinked ?? 0),
      telegramLinked: Number(summary?.telegramLinked ?? 0),
      withPositions: Number(summary?.withPositions ?? 0),
      positions: POSITIONS.map((position) => ({
        position,
        players: Number(byPosition.get(position)?.players ?? 0),
        freeAgents: Number(byPosition.get(position)?.freeAgents ?? 0),
      })),
    };
  }

  /**
   * Settled money only: PAID VIP charges, PAID entry fees (admin-marked ones
   * included — they carry the due amount) and PAID donations, in kopecks.
   */
  private async loadRevenue(): Promise<AnalyticsRevenueDto> {
    const rows = await this.dataSource.query<
      Array<{
        source: TRevenueSource;
        month: string;
        amount: string;
        recent: string;
      }>
    >(
      `WITH paid AS (
         SELECT 'vip' AS source, "amount" AS amount, COALESCE("paidAt", "updatedAt") AS at
           FROM "vip_payment" WHERE "status" = $1
         UNION ALL
         SELECT 'entryFees', "amountPaid", COALESCE("paidAt", "updatedAt")
           FROM "tournament_team_payment" WHERE "status"::text = $2
         UNION ALL
         SELECT 'donations', "amountPaid", COALESCE("paidAt", "updatedAt")
           FROM "tournament_donation" WHERE "status"::text = $2
       )
       SELECT source,
              to_char(at AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM') AS month,
              COALESCE(SUM(amount), 0)::bigint AS amount,
              COALESCE(SUM(amount) FILTER (WHERE at >= now() - interval '30 days'), 0)::bigint AS recent
         FROM paid
        GROUP BY source, month`,
      [VipPaymentStatus.PAID, PaymentStatus.PAID],
    );

    const emptySources = (): RevenueBySourceDto => ({
      vip: 0,
      entryFees: 0,
      donations: 0,
    });
    const total = emptySources();
    const last30Days = emptySources();
    const months = new Map<string, RevenueBySourceDto>();

    for (const row of rows) {
      const amount = Number(row.amount);
      total[row.source] += amount;
      last30Days[row.source] += Number(row.recent);
      const month = months.get(row.month) ?? emptySources();
      month[row.source] += amount;
      months.set(row.month, month);
    }

    const monthly: RevenueMonthDto[] = lastKyivMonths(REVENUE_MONTHS).map(
      (month) => ({ month, ...(months.get(month) ?? emptySources()) }),
    );

    return { total, last30Days, monthly };
  }

  private async loadVip(): Promise<AnalyticsVipDto> {
    const rows = await this.dataSource.query<
      Array<{
        active: number;
        lifetime: number;
        autoRenew: number;
        expiringSoon: number;
      }>
    >(
      `SELECT COUNT(*) FILTER (WHERE p."vipUntil" > now())::int AS "active",
              COUNT(*) FILTER (WHERE p."vipUntil" >= $1)::int AS "lifetime",
              COUNT(*) FILTER (WHERE p."vipUntil" > now() AND s."autoRenew")::int AS "autoRenew",
              COUNT(*) FILTER (
                WHERE p."vipUntil" > now()
                  AND p."vipUntil" < $1
                  AND p."vipUntil" <= now() + make_interval(days => $2::int)
              )::int AS "expiringSoon"
         FROM "player" p
         LEFT JOIN "vip_subscription" s ON s."playerId" = p."id"
        WHERE p."vipUntil" IS NOT NULL`,
      [VIP_LIFETIME_UNTIL, VIP_EXPIRING_DAYS],
    );
    const row = rows[0];
    return {
      active: Number(row?.active ?? 0),
      lifetime: Number(row?.lifetime ?? 0),
      autoRenew: Number(row?.autoRenew ?? 0),
      expiringSoon: Number(row?.expiringSoon ?? 0),
    };
  }

  /** Duels bucketed by the Kyiv day they were created; still-running duels are not counted. */
  private async loadDuelActivity(): Promise<AnalyticsDuelActivityDto> {
    const [dayRows, reviewRows] = await Promise.all([
      this.dataSource.query<
        Array<{ date: string; played: number; notPlayed: number }>
      >(
        `SELECT to_char("createdAt" AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM-DD') AS "date",
                COUNT(*) FILTER (WHERE "state" = $1)::int AS "played",
                COUNT(*) FILTER (WHERE "state" IN ($2, $3))::int AS "notPlayed"
           FROM "duel"
          WHERE "createdAt" >= now() - make_interval(days => $4::int)
          GROUP BY 1`,
        [
          DuelState.RESOLVED,
          DuelState.CANCELLED,
          DuelState.FAILED,
          DUEL_DAYS + 1,
        ],
      ),
      this.dataSource.query<Array<{ count: number }>>(
        `SELECT COUNT(*)::int AS "count" FROM "duel"
          WHERE "state" = $1 AND "adminReviewRequired" = true`,
        [DuelState.FAILED],
      ),
    ]);

    const byDay = new Map(dayRows.map((row) => [row.date, row]));
    return {
      daily: lastKyivDays(DUEL_DAYS).map((date) => ({
        date,
        played: Number(byDay.get(date)?.played ?? 0),
        notPlayed: Number(byDay.get(date)?.notPlayed ?? 0),
      })),
      awaitingReview: Number(reviewRows[0]?.count ?? 0),
    };
  }
}

const kyivDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` keys of the last `count` Kyiv days, oldest first, today included. */
function lastKyivDays(count: number, now = new Date()): string[] {
  // Calendar arithmetic on the Kyiv date, not `now - n * 24h`: DST days are 23/25 h long.
  const [year, month, day] = kyivDayFormat.format(now).split('-').map(Number);
  const days: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    days.push(
      new Date(Date.UTC(year, month - 1, day - offset))
        .toISOString()
        .slice(0, 10),
    );
  }
  return days;
}

/** `YYYY-MM` keys of the last `count` Kyiv months, oldest first, current month included. */
function lastKyivMonths(count: number, now = new Date()): string[] {
  const [year, month] = kyivDayFormat.format(now).split('-').map(Number);
  const months: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const index = year * 12 + (month - 1) - offset;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months;
}
