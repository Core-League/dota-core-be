import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThan, Repository } from 'typeorm';
import {
  DUEL_DEFAULT_REGION,
  DUEL_LOBBY_NAME_DEFAULT,
  DUEL_PENDING_TIMEOUT_SECONDS,
  DUEL_QUEUE_HEARTBEAT_TTL_SECONDS,
  DUEL_SAME_OPPONENT_DAILY_LIMIT,
  DuelCancelReason,
  DuelState,
} from './duel.constants';
import { Duel } from './duel.entity';
import { DuelEventsPublisher } from './duel-events.publisher';
import { DuelQueueEntry } from './duel-queue.entity';
import { DuelsService } from './duels.service';

/**
 * Pairs queued players (decision 7: ±50 at join, +50 every 30 s, both windows
 * must accept), prunes queue rows whose client stopped polling and gives up
 * on PENDING duels no bot claimed in 5 minutes (decisions 8, 12, 19).
 */
@Injectable()
export class DuelMatchmakerService {
  private readonly logger = new Logger(DuelMatchmakerService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(DuelQueueEntry)
    private readonly queue: Repository<DuelQueueEntry>,
    @InjectRepository(Duel) private readonly duels: Repository<Duel>,
    private readonly duelsService: DuelsService,
    private readonly events: DuelEventsPublisher,
  ) {}

  async tick(): Promise<void> {
    await this.pruneStaleQueue();
    await this.duelsService.expireAcceptTimeouts();
    await this.expireUnclaimedDuels();
    await this.pairPlayers();
  }

  private async pruneStaleQueue(): Promise<void> {
    const cutoff = new Date(
      Date.now() - DUEL_QUEUE_HEARTBEAT_TTL_SECONDS * 1000,
    );
    const result = await this.queue.delete({ lastSeenAt: LessThan(cutoff) });
    if (result.affected) {
      this.logger.log(`Dropped ${result.affected} silent queue entr(ies)`);
      this.events.queueChanged();
    }
  }

  private async expireUnclaimedDuels(): Promise<void> {
    const cutoff = new Date(Date.now() - DUEL_PENDING_TIMEOUT_SECONDS * 1000);
    const stale = await this.duels.find({
      where: {
        state: DuelState.PENDING,
        hostBotId: IsNull(),
        createdAt: LessThan(cutoff),
      },
    });
    for (const duel of stale) {
      await this.duelsService.cancelDuel(
        duel.id,
        DuelCancelReason.NO_BOTS_AVAILABLE,
        { requeue: true, error: 'no host bot claimed the duel in time' },
      );
      this.logger.warn(
        `Duel ${duel.id} cancelled: no free host bot for ${DUEL_PENDING_TIMEOUT_SECONDS}s — players re-queued`,
      );
    }
  }

  private async duelsTodayBetween(a: string, b: string): Promise<number> {
    const rows: Array<{ count: number | string }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count
         FROM "duel"
        WHERE "state" = $1
          AND (("player1Id" = $2 AND "player2Id" = $3) OR ("player1Id" = $3 AND "player2Id" = $2))
          AND ("finishedAt" AT TIME ZONE 'Europe/Kyiv')::date = (now() AT TIME ZONE 'Europe/Kyiv')::date`,
      [DuelState.RESOLVED, a, b],
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async pairPlayers(): Promise<void> {
    const entries = await this.queue.find({ order: { joinedAt: 'ASC' } });
    if (entries.length < 2) return;

    const now = Date.now();
    const windowOf = (e: DuelQueueEntry) =>
      DuelsService.queueWindow(
        Math.max(0, Math.floor((now - e.joinedAt.getTime()) / 1000)),
      );

    const taken = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      if (taken.has(a.playerId)) continue;
      const wa = windowOf(a);
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j];
        if (taken.has(b.playerId)) continue;
        const diff = Math.abs(a.rating - b.rating);
        if (diff > Math.min(wa, windowOf(b))) continue;
        if (
          (await this.duelsTodayBetween(a.playerId, b.playerId)) >=
          DUEL_SAME_OPPONENT_DAILY_LIMIT
        ) {
          continue;
        }
        const lobbyName =
          process.env.HOSTBOT_LOBBY_NAME?.trim() || DUEL_LOBBY_NAME_DEFAULT;
        // An empty/unset HOSTBOT_REGION (the CI forwards it even when blank) means the default, not region 0.
        const rawRegion = process.env.HOSTBOT_REGION?.trim();
        const region = rawRegion ? Number(rawRegion) : NaN;
        const duel = await this.duelsService.createDuelFromQueue(
          a,
          b,
          lobbyName,
          Number.isFinite(region) && region > 0 ? region : DUEL_DEFAULT_REGION,
        );
        if (!duel) continue; // someone left the queue meanwhile
        taken.add(a.playerId);
        taken.add(b.playerId);
        this.logger.log(
          `Paired ${a.playerId} (${a.rating}) vs ${b.playerId} (${b.rating}) → duel ${duel.id}`,
        );
        break;
      }
    }
  }
}
