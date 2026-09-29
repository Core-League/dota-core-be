import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  DUEL_DEFAULT_REGION,
  DUEL_GAME_TIMEOUT_SECONDS,
  DUEL_JOIN_TIMEOUT_SECONDS,
  DUEL_LOBBY_NAME_DEFAULT,
  DuelFailReason,
} from '../duels/duel.constants';
import { DuelsService } from '../duels/duels.service';
import {
  HostBotsService,
  type HostBotAccount,
} from '../duels/host-bots.service';
import { HostBotWorker, type HostBotWorkerConfig } from './host-bot.worker';
import { RealtimeStatsService } from './realtime-stats.service';

const CLAIM_INTERVAL_MS = 3_000;
const RELOAD_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Owns one `HostBotWorker` per enabled `host_bot` row, hands PENDING duels to
 * free bots and keeps the heartbeat that lets the admin panel see the worker
 * is alive. Lives only in the bot-worker process.
 */
@Injectable()
export class HostBotPool implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HostBotPool.name);
  private readonly workers = new Map<number, HostBotWorker>();
  private timers: NodeJS.Timeout[] = [];
  private claiming = false;
  private reloading = false;

  constructor(
    private readonly duels: DuelsService,
    private readonly hostBots: HostBotsService,
    private readonly stats: RealtimeStatsService,
  ) {}

  private get config(): HostBotWorkerConfig {
    return {
      lobbyName:
        process.env.HOSTBOT_LOBBY_NAME?.trim() || DUEL_LOBBY_NAME_DEFAULT,
      joinTimeoutSeconds: envInt(
        'HOSTBOT_JOIN_TIMEOUT',
        DUEL_JOIN_TIMEOUT_SECONDS,
      ),
      gameTimeoutSeconds: envInt(
        'HOSTBOT_GAME_TIMEOUT',
        DUEL_GAME_TIMEOUT_SECONDS,
      ),
      tickMs: 3_000,
      statsPollMs: 15_000,
    };
  }

  async onModuleInit(): Promise<void> {
    if (!process.env.HOSTBOT_SECRET_KEY?.trim()) {
      this.logger.error(
        'HOSTBOT_SECRET_KEY is not set — bot passwords cannot be decrypted, no bots will start',
      );
      return;
    }
    if (!this.stats.enabled) {
      this.logger.warn(
        'STEAM_API_KEY is not set — duels will have no per-player stats',
      );
    }
    await this.bootstrapAccountsIfEmpty();
    await this.reload();
    await this.recoverOrphans();
    this.timers = [
      setInterval(() => void this.claim(), CLAIM_INTERVAL_MS),
      setInterval(() => void this.reload(), RELOAD_INTERVAL_MS),
      setInterval(() => void this.heartbeat(), HEARTBEAT_INTERVAL_MS),
    ];
    this.logger.log(`Pool started with ${this.workers.size} bot(s)`);
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Stopping pool…');
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await Promise.all([...this.workers.values()].map((w) => w.stop()));
    this.workers.clear();
  }

  /** First start in Docker: seed accounts from `HOSTBOT_BOOTSTRAP_ACCOUNTS_JSON` if the table is empty. */
  private async bootstrapAccountsIfEmpty(): Promise<void> {
    const raw = process.env.HOSTBOT_BOOTSTRAP_ACCOUNTS_JSON?.trim();
    if (!raw) return;
    const existing = await this.hostBots.list();
    if (existing.length) return;
    let accounts: Array<{
      username: string;
      password: string;
      region?: number;
    }>;
    try {
      accounts = JSON.parse(raw) as typeof accounts;
    } catch {
      this.logger.error(
        'HOSTBOT_BOOTSTRAP_ACCOUNTS_JSON is not valid JSON — ignored',
      );
      return;
    }
    for (const a of accounts) {
      await this.hostBots.create({
        accountName: a.username,
        password: a.password,
        region: a.region ?? envInt('HOSTBOT_REGION', DUEL_DEFAULT_REGION),
      });
      this.logger.log(`Bootstrap: added ${a.username} to the pool`);
    }
  }

  /** Start workers for new/enabled rows, stop workers for removed/disabled ones. */
  private async reload(): Promise<void> {
    if (this.reloading) return;
    this.reloading = true;
    try {
      let accounts: HostBotAccount[];
      try {
        accounts = await this.hostBots.loadRunnableAccounts();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`could not load bot accounts: ${message}`);
        return;
      }
      const wanted = new Map(accounts.map((a) => [a.id, a]));

      for (const [id, worker] of this.workers) {
        const account = wanted.get(id);
        const changed =
          account &&
          (account.password !== worker.account.password ||
            account.accountName !== worker.account.accountName);
        if (!account || changed) {
          this.logger.log(
            `Stopping bot #${id} (${worker.account.accountName}): ${account ? 'credentials changed' : 'removed/disabled'}`,
          );
          await worker.stop();
          this.workers.delete(id);
        }
      }
      for (const account of accounts) {
        if (this.workers.has(account.id)) continue;
        const worker = new HostBotWorker(account, this.config, {
          duels: this.duels,
          hostBots: this.hostBots,
          stats: this.stats,
        });
        this.workers.set(account.id, worker);
        worker.start();
        this.logger.log(
          `Started bot #${account.id} (${account.accountName}, region ${account.region})`,
        );
      }
    } finally {
      this.reloading = false;
    }
  }

  /**
   * After a restart: duels that were mid-flight get re-adopted by their bot
   * (if it is still in the pool) or failed so an admin can decide.
   */
  private async recoverOrphans(): Promise<void> {
    const active = await this.duels.findActiveClaimedDuels();
    for (const duel of active) {
      const worker =
        duel.hostBotId != null ? this.workers.get(duel.hostBotId) : undefined;
      if (worker) {
        this.logger.log(
          `Duel ${duel.id} (${duel.state}) belongs to bot #${duel.hostBotId} — re-adopting`,
        );
        worker.adopt(duel);
      } else {
        this.logger.error(
          `Duel ${duel.id} (${duel.state}) has no bot in the pool — FAILED (lobby_lost)`,
        );
        await this.duels.failDuel(
          duel.id,
          DuelFailReason.LOBBY_LOST,
          'host bot missing after restart',
        );
      }
    }
  }

  private async claim(): Promise<void> {
    if (this.claiming) return;
    this.claiming = true;
    try {
      for (const worker of this.workers.values()) {
        if (!worker.isFree) continue;
        const duel = await this.duels.claimPendingDuel(worker.id);
        if (!duel) return; // nothing waiting — no point asking again for the other bots
        try {
          await worker.startDuel(duel);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `bot #${worker.id} could not start duel ${duel.id}: ${message}`,
          );
          await this.duels.releaseClaim(duel.id);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`claim loop failed: ${message}`);
    } finally {
      this.claiming = false;
    }
  }

  private async heartbeat(): Promise<void> {
    try {
      await this.hostBots.heartbeat([...this.workers.keys()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`heartbeat failed: ${message}`);
    }
  }
}
