import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  DUEL_DEFAULT_GAME_MODE,
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
/** Git-ignored seed file at the repo root; `HOSTBOT_ACCOUNTS_FILE` overrides the path. */
const DEFAULT_ACCOUNTS_FILE = 'hostbot-accounts.json';

interface SeedAccount {
  username: string;
  password: string;
  region?: number;
}

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
      gameMode: envInt('HOSTBOT_GAME_MODE', DUEL_DEFAULT_GAME_MODE),
      tickMs: 3_000,
      statsPollMs: 15_000,
    };
  }

  async onModuleInit(): Promise<void> {
    // The timers are what keeps this HTTP-less process alive, so they are
    // installed unconditionally: a missing secret key or an empty pool must
    // wait and retry, not let the event loop drain and the container restart.
    this.timers = [
      setInterval(() => void this.claim(), CLAIM_INTERVAL_MS),
      setInterval(() => void this.reload(), RELOAD_INTERVAL_MS),
      setInterval(() => void this.heartbeat(), HEARTBEAT_INTERVAL_MS),
    ];

    if (!this.hasSecretKey()) {
      this.logger.error(
        'HOSTBOT_SECRET_KEY is not set — bot passwords cannot be decrypted. ' +
          'Set it (npm run bot:keygen) and restart; retrying every 30 s meanwhile.',
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
    // Orphan recovery must never take the whole worker down: a schema drift
    // or a DB blip here would otherwise restart the process in a loop and no
    // bot would ever come online. Log it; the duels stay for admin review.
    try {
      await this.recoverOrphans();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `orphan recovery failed, bots start anyway: ${message}`,
      );
    }
    this.logger.log(`Pool started with ${this.workers.size} bot(s)`);
  }

  private hasSecretKey(): boolean {
    return !!process.env.HOSTBOT_SECRET_KEY?.trim();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Stopping pool…');
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await Promise.all([...this.workers.values()].map((w) => w.stop()));
    this.workers.clear();
  }

  /**
   * Seed the pool on first start (only while `host_bot` is empty). Source, in
   * order: `HOSTBOT_BOOTSTRAP_ACCOUNTS_JSON` (prod: a GitHub secret), else the
   * git-ignored `hostbot-accounts.json` at the repo root (local / self-hosted;
   * path override: `HOSTBOT_ACCOUNTS_FILE`). Format either way:
   * `[{"username":"…","password":"…","region":3}, …]`.
   */
  private async bootstrapAccountsIfEmpty(): Promise<void> {
    const existing = await this.hostBots.list();
    if (existing.length) return;

    const seed = this.readSeedAccounts();
    if (!seed) return;
    for (const a of seed.accounts) {
      if (!a.username || !a.password) {
        this.logger.warn(
          `Seed (${seed.source}): entry without username/password skipped`,
        );
        continue;
      }
      await this.hostBots.create({
        accountName: a.username,
        password: a.password,
        region: a.region ?? envInt('HOSTBOT_REGION', DUEL_DEFAULT_REGION),
      });
      this.logger.log(`Seed (${seed.source}): added ${a.username} to the pool`);
    }
  }

  private readSeedAccounts(): {
    source: string;
    accounts: SeedAccount[];
  } | null {
    const fromEnv = process.env.HOSTBOT_BOOTSTRAP_ACCOUNTS_JSON?.trim();
    if (fromEnv) {
      const accounts = this.parseSeed(
        fromEnv,
        'HOSTBOT_BOOTSTRAP_ACCOUNTS_JSON',
      );
      return accounts ? { source: 'env', accounts } : null;
    }
    const file = resolve(
      process.cwd(),
      process.env.HOSTBOT_ACCOUNTS_FILE?.trim() || DEFAULT_ACCOUNTS_FILE,
    );
    if (!existsSync(file)) {
      this.logger.log(
        `No bot accounts seeded: neither HOSTBOT_BOOTSTRAP_ACCOUNTS_JSON nor ${file} present`,
      );
      return null;
    }
    const accounts = this.parseSeed(readFileSync(file, 'utf8'), file);
    return accounts ? { source: file, accounts } : null;
  }

  private parseSeed(raw: string, label: string): SeedAccount[] | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
      return parsed as SeedAccount[];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `${label} is not a valid accounts JSON (${message}) — ignored`,
      );
      return null;
    }
  }

  /** Start workers for new/enabled rows, stop workers for removed/disabled ones. */
  private async reload(): Promise<void> {
    if (this.reloading) return;
    if (!this.hasSecretKey()) return; // logged once at startup
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
        const reloadAsked =
          account &&
          account.reloadRequestedAt > worker.startedAt &&
          !worker.isHosting;
        if (reloadAsked) {
          this.logger.log(
            `Restarting bot #${id} (${worker.account.accountName}) on admin request`,
          );
          await worker.stop({ leaveLobby: true });
          this.workers.delete(id);
          continue;
        }
        if (!account || changed) {
          this.logger.log(
            `Stopping bot #${id} (${worker.account.accountName}): ${account ? 'credentials changed' : 'removed/disabled'}`,
          );
          // Removed / disabled / re-credentialed: this bot will not come back, so leave its lobby.
          await worker.stop({ leaveLobby: true });
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
