import { Logger } from '@nestjs/common';
import {
  DUEL_GC_DETAILS_INTERVAL_SECONDS,
  DUEL_LOBBY_LOST_GRACE_SECONDS,
  DUEL_POSTGAME_OUTCOME_WAIT_SECONDS,
  DUEL_RESULT_DELAY_SECONDS,
  DuelCancelReason,
  DuelFailReason,
  DuelState,
  DUEL_TERMINAL_STATES,
  HostBotStatus,
  type DuelLobbyPlayer,
  type DuelLobbySide,
  type DuelStats,
} from '../duels/duel.constants';
import type { Duel } from '../duels/duel.entity';
import type { DuelsService } from '../duels/duels.service';
import type {
  HostBotAccount,
  HostBotsService,
} from '../duels/host-bots.service';
import { DotaGcClient } from './dota-gc.client';
import {
  DOTA_GC_TEAM,
  LobbyState,
  accountIdOf,
  type GcLobby,
  type GcMatchDetails,
} from './dota-gc.protocol';
import {
  duelParticipants,
  type RealtimeStatsRaw,
  type RealtimeStatsService,
  type StatsParticipant,
} from './realtime-stats.service';

/**
 * How often `GetMatchDetails` is asked once the game looks over (the board
 * shows post game, or it stopped answering). Valve publishes a lobby game
 * right after the server signs it out, so this is what makes the result land
 * within seconds instead of on the next recovery pass.
 */
const WEB_API_POLL_MS = 5_000;
/** After the server is gone: how long Valve gets to publish the match before the last snapshot decides. */
const WEB_API_WAIT_MS = 3 * 60_000;

/**
 * How long the live scoreboard may stay silent, after it has answered at
 * least once, before the game server counts as gone. `GetRealtimeStats`
 * regularly returns 5xx / empty payloads for a few ticks while the game is
 * still running, so this is a wall-clock window, not a tick count. The Web
 * API is asked throughout, so a real end is normally recorded long before.
 */
const SERVER_GONE_AFTER_MS = 60_000;
/** …and at least this many consecutive misses (guards against one slow tick). */
const SERVER_GONE_MIN_MISSES = 3;
/** How often the "still following" line is logged while a game runs without the lobby. */
const FOLLOW_LOG_INTERVAL_MS = 30_000;

export interface HostBotWorkerConfig {
  lobbyName: string;
  /** `DOTA_GameMode` of the hosted lobby (5 All Random, 21 1v1 Solo Mid). */
  gameMode: number;
  joinTimeoutSeconds: number;
  gameTimeoutSeconds: number;
  tickMs: number;
  statsPollMs: number;
}

export interface HostBotWorkerDeps {
  duels: DuelsService;
  hostBots: HostBotsService;
  stats: RealtimeStatsService;
}

interface InvitedPlayer {
  playerId: string;
  steamId64: string;
  accountId: number;
}

/** In-memory state of the duel this bot is hosting right now. */
class DuelCtx {
  readonly id: string;
  readonly players: [InvitedPlayer, InvitedPlayer];
  readonly invited: Map<number, InvitedPlayer>;
  readonly password: string;
  readonly region: number;
  lobbyId: string | null;
  expectingCreate = false;
  createAttempts = 0;
  launched = false;
  finished = false;
  radiantAcc: number | null = null;
  direAcc: number | null = null;
  lastRosterSig: string | null = null;
  readonly startedAt = Date.now();
  joinDeadline: number;
  gameDeadline: number | null = null;
  lastServerId: string | null = null;
  lastStats: RealtimeStatsRaw | null = null;
  lastCreateAt = 0;
  /** Valve match id once the GC assigned one (at launch). */
  lastMatchId: string | null = null;
  /** When the lobby object disappeared after launch; null while we still see it. */
  lobbyLostAt: number | null = null;
  /** When we first saw the game end (outcome may lag behind the state). */
  postgameAt: number | null = null;
  /** The lobby reached RUN after our launch — from then on any other state means the game ended. */
  sawRun = false;
  /** First moment we knew the game was over (lobby left RUN, or vanished after RUN). */
  gameEndedAt: number | null = null;
  /** GC match-details polling bookkeeping. */
  gcDetailsAttempts = 0;
  gcDetailsLastAt = 0;
  /** Last lobby object we saw — the GC removes it the moment the match ends, so this is the final snapshot. */
  lastLobby: GcLobby | null = null;
  lastLobbyState: number | null = null;
  lastLobbyOutcome = 0;
  /** Live-scoreboard following once the lobby is gone. */
  serverSeenAt: number | null = null;
  serverMisses = 0;
  lastFollowLogAt = 0;
  lastFollowLine: string | null = null;
  /** When the scoreboard was declared gone; the Web API is polled for the match from then on. */
  serverGoneAt: number | null = null;
  webApiLastAt = 0;
  webApiAttempts = 0;

  get participants(): StatsParticipant[] {
    return this.players.map((p) => ({
      playerId: p.playerId,
      steamId64: p.steamId64,
    }));
  }

  constructor(duel: Duel, joinTimeoutSeconds: number) {
    if (!duel.player1?.steamId || !duel.player2?.steamId) {
      throw new Error(
        `duel ${duel.id}: both players need a linked Steam account`,
      );
    }
    this.id = duel.id;
    const p1: InvitedPlayer = {
      playerId: duel.player1.id,
      steamId64: duel.player1.steamId,
      accountId: accountIdOf(duel.player1.steamId),
    };
    const p2: InvitedPlayer = {
      playerId: duel.player2.id,
      steamId64: duel.player2.steamId,
      accountId: accountIdOf(duel.player2.steamId),
    };
    this.players = [p1, p2];
    this.invited = new Map([
      [p1.accountId, p1],
      [p2.accountId, p2],
    ]);
    this.password = duel.lobbyPassword;
    this.region = duel.region;
    this.lobbyId = duel.lobbyId;
    this.lastMatchId = duel.dotaMatchId;
    this.lastServerId = duel.serverSteamId;
    this.joinDeadline = this.startedAt + joinTimeoutSeconds * 1000;
  }

  playerIdOf(accountId: number | null): string | null {
    return accountId == null
      ? null
      : (this.invited.get(accountId)?.playerId ?? null);
  }
}

/**
 * One Steam account hosting 1v1 Mid lobbies, one duel at a time — the Node
 * port of the Python `BotWorker`. Event handlers from the GC plus a 3 s tick
 * drive the active duel; every DB write goes through `DuelsService` so the
 * rating rules live in one place.
 *
 * The bot is the lobby host but never takes one of the two game slots: it
 * sits in `PLAYER_POOL`. The GC drops pool members from the lobby when the
 * game server starts, so the match itself is followed through the server's
 * live scoreboard (`followGameByScoreboard`). Seats that would keep the bot
 * in the lobby do not work for a headless client: the GC ignores `SPECTATOR`
 * for the host, and a `BROADCASTER` is waited for on the loading screen — the
 * server aborts the match ~45 s later because the bot never connects.
 */
export class HostBotWorker {
  private readonly logger: Logger;
  private gc: DotaGcClient | null = null;
  private ctx: DuelCtx | null = null;
  /** Duel to re-adopt once the GC is ready (after a worker restart). */
  private pendingAdoption: Duel | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private reloginTimer: NodeJS.Timeout | null = null;
  private backoffMs = 5_000;
  private stopping = false;
  private ticking = false;
  private gaveUp = false;
  private startedAtMs = 0;

  constructor(
    readonly account: HostBotAccount,
    private readonly config: HostBotWorkerConfig,
    private readonly deps: HostBotWorkerDeps,
  ) {
    this.logger = new Logger(`HostBot:${account.accountName}`);
  }

  get id(): number {
    return this.account.id;
  }

  /** When `start()` last ran (epoch ms); admin reload requests newer than this restart the bot. */
  get startedAt(): number {
    return this.startedAtMs;
  }

  get isHosting(): boolean {
    return this.ctx != null;
  }

  get gcReady(): boolean {
    return this.gc?.ready ?? false;
  }

  get isFree(): boolean {
    return (
      this.gcReady &&
      this.ctx == null &&
      this.pendingAdoption == null &&
      !this.stopping
    );
  }

  get currentDuelId(): string | null {
    return this.ctx?.id ?? null;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    this.stopping = false;
    this.gaveUp = false;
    this.startedAtMs = Date.now();
    this.connect();
    this.tickTimer = setInterval(
      () => void this.safeTick(),
      this.config.tickMs,
    );
  }

  /**
   * Stops the worker. The lobby is kept by default: a process restart (deploy)
   * must not throw away a running game — the bot stays a member and the
   * restarted worker re-adopts it from the GC cache. Pass `leaveLobby` when
   * the bot is being removed for good.
   */
  async stop(opts: { leaveLobby?: boolean } = {}): Promise<void> {
    this.stopping = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.reloginTimer) clearTimeout(this.reloginTimer);
    this.stopStatsPolling();
    this.tickTimer = null;
    if (opts.leaveLobby && this.ctx && this.gc?.lobby) {
      try {
        this.gc.leaveLobby();
      } catch {
        /* best effort */
      }
    } else if (this.ctx) {
      this.logger.log(
        `Stopping mid-duel ${this.ctx.id} — staying in the lobby for re-adoption`,
      );
    }
    this.gc?.logOff();
    this.gc = null;
    await this.setStatus(HostBotStatus.OFFLINE);
  }

  private connect(): void {
    if (this.stopping || this.gaveUp) return;
    this.gc?.logOff();
    const gc = new DotaGcClient({
      accountName: this.account.accountName,
      password: this.account.password,
      label: this.account.accountName,
    });
    this.gc = gc;

    gc.on('ready', () => void this.onGcReady());
    gc.on('notReady', () => void this.setStatus(HostBotStatus.OFFLINE));
    gc.on('lobbyNew', (lobby: GcLobby) => void this.onLobbyNew(lobby));
    gc.on('lobbyChanged', () => void this.safeTick());
    gc.on('lobbyRemoved', () => void this.safeTick());
    gc.on('matchDetails', (d: GcMatchDetails) => void this.onMatchDetails(d));
    gc.on('disconnected', (eresult: number, msg?: string) => {
      this.logger.warn(
        `Steam disconnected (${eresult} ${msg ?? ''}) — steam-user will reconnect`,
      );
      void this.setStatus(HostBotStatus.OFFLINE, {
        lastError: `disconnected: ${eresult}`,
      });
    });
    gc.on('fatal', (err: Error & { eresult?: number }) => {
      const fatalForGood =
        err.message === 'steam_guard_required' ||
        err.eresult === 5 /* InvalidPassword */ ||
        err.eresult === 63 /* AccountLoginDeniedNeedTwoFactor */ ||
        err.eresult === 85; /* TwoFactorCodeMismatch */
      void this.setStatus(HostBotStatus.OFFLINE, { lastError: err.message });
      if (fatalForGood) {
        this.gaveUp = true;
        this.logger.error(
          `Giving up on this account: ${err.message}. Fix the credentials and re-enable it.`,
        );
        return;
      }
      this.scheduleRelogin(`steam error: ${err.message}`);
    });

    void this.setStatus(HostBotStatus.OFFLINE);
    gc.logOn();
  }

  private scheduleRelogin(reason: string): void {
    if (this.stopping || this.reloginTimer) return;
    this.logger.warn(`${reason} — retrying login in ${this.backoffMs / 1000}s`);
    this.reloginTimer = setTimeout(() => {
      this.reloginTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, 300_000);
      this.connect();
    }, this.backoffMs);
  }

  private async setStatus(
    status: HostBotStatus,
    extra: { lastError?: string | null } = {},
  ): Promise<void> {
    try {
      await this.deps.hostBots.setStatus(this.id, {
        status,
        currentDuelId: this.ctx?.id ?? null,
        steamId64: this.gc?.steamId64 ?? undefined,
        ...extra,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`could not update host_bot row: ${message}`);
    }
  }

  // ── GC events ────────────────────────────────────────────────────────────

  private async onGcReady(): Promise<void> {
    this.backoffMs = 5_000;
    const gc = this.gc;
    if (!gc) return;

    if (this.pendingAdoption) {
      await this.tryAdopt(this.pendingAdoption);
      this.pendingAdoption = null;
      return;
    }

    if (this.ctx) {
      // Reconnected mid-duel: the SO cache tells us whether the lobby survived.
      if (gc.lobby && gc.lobby.lobby_id === this.ctx.lobbyId) {
        this.logger.log(`GC back, lobby ${gc.lobby.lobby_id} still ours`);
      }
      await this.setStatus(HostBotStatus.BUSY, { lastError: null });
      return;
    }

    if (gc.lobby) {
      this.logger.log(`Leaving stale lobby ${gc.lobby.lobby_id}`);
      gc.leaveLobby();
    }
    await this.setStatus(HostBotStatus.FREE, { lastError: null });
  }

  private async onLobbyNew(lobby: GcLobby): Promise<void> {
    const ctx = this.ctx;
    const gc = this.gc;
    if (!ctx || !gc) {
      this.logger.log(`Ignoring lobby ${lobby.lobby_id} — no active duel`);
      gc?.leaveLobby();
      return;
    }
    if (!ctx.expectingCreate) {
      // e.g. re-adopted lobby re-sent by the cache
      void this.safeTick();
      return;
    }
    ctx.expectingCreate = false;
    ctx.lobbyId = lobby.lobby_id;
    ctx.joinDeadline = Date.now() + this.config.joinTimeoutSeconds * 1000;
    this.logger.log(
      `Lobby ${lobby.lobby_id} created — moving to player pool, inviting both`,
    );
    try {
      gc.setTeamSlot(DOTA_GC_TEAM.PLAYER_POOL);
      for (const p of ctx.players) gc.inviteToLobby(p.steamId64);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`invite failed: ${message}`);
    }
    await this.deps.duels.markLobbyReady(ctx.id, lobby.lobby_id);
  }

  // ── duel assignment ──────────────────────────────────────────────────────

  /** Called by the pool for a duel that was just claimed for this bot. */
  async startDuel(duel: Duel): Promise<void> {
    if (!this.isFree) throw new Error('bot_not_free');
    let ctx: DuelCtx;
    try {
      ctx = new DuelCtx(duel, this.config.joinTimeoutSeconds);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.duels.cancelDuel(
        duel.id,
        DuelCancelReason.LOBBY_NOT_CREATED,
        {
          error: message,
        },
      );
      return;
    }
    this.ctx = ctx;
    await this.setStatus(HostBotStatus.BUSY, { lastError: null });
    this.logger.log(
      `Duel ${duel.id}: ${ctx.players[0].steamId64} vs ${ctx.players[1].steamId64}`,
    );
    this.createLobby();
  }

  /** Called by the pool at startup for a duel this bot was hosting before a restart. */
  adopt(duel: Duel): void {
    this.pendingAdoption = duel;
    if (this.gcReady) {
      void this.tryAdopt(duel).then(() => {
        this.pendingAdoption = null;
      });
    }
  }

  private async tryAdopt(duel: Duel): Promise<void> {
    const gc = this.gc;
    if (!gc) return;
    const lobby = gc.lobby;
    const lobbyMatches =
      !!lobby && !!duel.lobbyId && lobby.lobby_id === duel.lobbyId;
    // LIVE without the lobby is the normal case (the GC drops the bot at
    // server start): with the server id we keep following the scoreboard.
    const canFollow =
      duel.state === DuelState.LIVE &&
      !!duel.serverSteamId &&
      this.deps.stats.enabled;
    if (
      duel.state === DuelState.LOBBY_CREATING ||
      (!lobbyMatches && !canFollow)
    ) {
      if (duel.state === DuelState.LOBBY_CREATING) {
        this.logger.warn(
          `Duel ${duel.id} was mid-creation — releasing it back to PENDING`,
        );
        await this.deps.duels.releaseClaim(duel.id);
      } else if (
        duel.state === DuelState.LIVE &&
        duel.dotaMatchId &&
        (await this.resolveFromWebApi(
          duel.id,
          duel.dotaMatchId,
          duelParticipants(duel),
        ))
      ) {
        this.logger.log(
          `Duel ${duel.id}: lobby gone after restart, result recovered from the Web API`,
        );
      } else {
        this.logger.error(
          `Duel ${duel.id}: lobby ${duel.lobbyId} is gone after restart — FAILED`,
        );
        await this.deps.duels.failDuel(
          duel.id,
          DuelFailReason.LOBBY_LOST,
          'worker restarted, lobby missing',
        );
      }
      if (lobby) gc.leaveLobby();
      await this.setStatus(HostBotStatus.FREE);
      return;
    }
    let ctx: DuelCtx;
    try {
      ctx = new DuelCtx(duel, this.config.joinTimeoutSeconds);
    } catch {
      await this.deps.duels.failDuel(
        duel.id,
        DuelFailReason.LOBBY_LOST,
        'players lost Steam link',
      );
      gc.leaveLobby();
      return;
    }
    if (duel.lobbyReadyAt) {
      ctx.joinDeadline =
        duel.lobbyReadyAt.getTime() + this.config.joinTimeoutSeconds * 1000;
    }
    if (duel.state === DuelState.LIVE) {
      ctx.launched = true;
      ctx.sawRun = true;
      ctx.gameDeadline =
        (duel.liveAt?.getTime() ?? Date.now()) +
        this.config.gameTimeoutSeconds * 1000;
      ctx.radiantAcc = duel.radiantPlayerId
        ? (ctx.players.find((p) => p.playerId === duel.radiantPlayerId)
            ?.accountId ?? null)
        : null;
      ctx.direAcc = duel.direPlayerId
        ? (ctx.players.find((p) => p.playerId === duel.direPlayerId)
            ?.accountId ?? null)
        : null;
    }
    if (!lobbyMatches) ctx.lobbyLostAt = Date.now();
    this.ctx = ctx;
    this.logger.log(
      `Re-adopted duel ${duel.id} (${duel.state}) ${lobbyMatches ? `in lobby ${lobby?.lobby_id ?? '?'}` : `via server ${duel.serverSteamId ?? '?'}`}`,
    );
    await this.setStatus(HostBotStatus.BUSY);
    if (ctx.launched && lobbyMatches) this.startStatsPolling();
  }

  private createLobby(): void {
    const ctx = this.ctx;
    const gc = this.gc;
    if (!ctx || !gc) return;
    if (gc.lobby) {
      this.logger.log(
        `Leaving old lobby ${gc.lobby.lobby_id} before creating a new one`,
      );
      gc.leaveLobby();
    }
    ctx.expectingCreate = true;
    ctx.createAttempts += 1;
    ctx.lastCreateAt = Date.now();
    this.logger.log(
      `create_practice_lobby (attempt ${ctx.createAttempts}, region ${ctx.region})`,
    );
    gc.createPracticeLobby({
      gameName: this.config.lobbyName,
      passKey: ctx.password,
      serverRegion: ctx.region,
      gameMode: this.config.gameMode,
    });
  }

  // ── tick ─────────────────────────────────────────────────────────────────

  private async safeTick(): Promise<void> {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    try {
      await this.tick();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`tick failed: ${message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async tick(): Promise<void> {
    const ctx = this.ctx;
    const gc = this.gc;
    if (!ctx || !gc) return;
    const now = Date.now();

    // Admin cancelled it (or another process finished it) → drop the lobby.
    const state = await this.deps.duels.getState(ctx.id);
    if (state == null || DUEL_TERMINAL_STATES.includes(state)) {
      this.logger.log(`Duel ${ctx.id} is ${state ?? 'gone'} — cleaning up`);
      await this.finish();
      return;
    }

    const lobby = gc.lobby;
    if (!lobby) {
      if (ctx.launched && !ctx.finished) {
        // The GC removes unassigned members — the bot — from the lobby when
        // the game server starts, so the whole match is played after this
        // point. Valve keeps no record of 1v1 practice games, so the match is
        // followed through the server's live scoreboard until it shows a
        // winner or the server goes away.
        if (ctx.lobbyLostAt == null) {
          ctx.lobbyLostAt = now;
          this.stopStatsPolling();
          this.logger.log(
            `Lobby gone after launch (the bot is not in the game) — following match ${ctx.lastMatchId ?? '?'} on server ${ctx.lastServerId ?? '?'} via the live scoreboard`,
          );
          const last = ctx.lastLobby;
          const lastOutcome = last?.match_outcome ?? 0;
          if (last && (lastOutcome === 2 || lastOutcome === 3)) {
            ctx.finished = true;
            this.logger.log(
              `Result from the last lobby snapshot: outcome=${lastOutcome}`,
            );
            await this.reportFromLobby(ctx, last);
            return;
          }
        }
        if (ctx.gameDeadline != null && now > ctx.gameDeadline) {
          this.logger.error(
            `Game did not finish in time — FAILED (game_timeout)`,
          );
          await this.deps.duels.failDuel(ctx.id, DuelFailReason.GAME_TIMEOUT);
          await this.finish();
          return;
        }
        if (!this.deps.stats.enabled || !ctx.lastServerId) {
          // No scoreboard to follow: wait out the grace period for the lobby
          // to come back, then the Web API, then admin review.
          if (now - ctx.lobbyLostAt < DUEL_LOBBY_LOST_GRACE_SECONDS * 1000) {
            return;
          }
          if (
            ctx.lastMatchId &&
            (await this.resolveFromWebApi(
              ctx.id,
              ctx.lastMatchId,
              ctx.participants,
            ))
          ) {
            ctx.finished = true;
            await this.finish();
            return;
          }
          this.logger.error(
            `Lobby gone and no scoreboard (STEAM_API_KEY / server id) — FAILED (lobby_lost)`,
          );
          await this.deps.duels.failDuel(ctx.id, DuelFailReason.LOBBY_LOST);
          await this.finish();
          return;
        }
        await this.followGameByScoreboard(ctx, now);
        return;
      }
      if (
        ctx.expectingCreate &&
        gc.ready &&
        now - ctx.lastCreateAt > 30_000 &&
        ctx.createAttempts < 3
      ) {
        this.createLobby();
        return;
      }
      if (!ctx.launched && now > ctx.joinDeadline) {
        this.logger.error(
          `Lobby never appeared — cancelling, players re-queued`,
        );
        await this.deps.duels.cancelDuel(
          ctx.id,
          DuelCancelReason.LOBBY_NOT_CREATED,
          {
            requeue: true,
            error: 'GC did not create the lobby',
          },
        );
        await this.finish();
      }
      return;
    }

    const botAcc = gc.accountId;
    // A member row without a steam id (seen after an aborted launch) must not
    // kill the tick — it is simply nobody.
    const members = (lobby.all_members ?? [])
      .filter((m) => !!m.id)
      .map((m) => ({
        accountId: accountIdOf(m.id),
        team: m.team,
      }));
    const inLobby = new Set(members.map((m) => m.accountId));

    // 1) keep the bot out of the game slots (only before launch — never
    //    send seat changes during a game)
    const me = members.find((m) => m.accountId === botAcc);
    if (me && !ctx.launched && me.team !== DOTA_GC_TEAM.PLAYER_POOL) {
      gc.setTeamSlot(DOTA_GC_TEAM.PLAYER_POOL);
    }

    // 2) kick anyone who was not invited
    for (const m of members) {
      if (
        m.accountId &&
        m.accountId !== botAcc &&
        !ctx.invited.has(m.accountId)
      ) {
        this.logger.warn(`Kicking uninvited account ${m.accountId}`);
        gc.kick(m.accountId);
      }
    }

    const radiant = members
      .filter((m) => m.team === DOTA_GC_TEAM.GOOD_GUYS)
      .map((m) => m.accountId);
    const dire = members
      .filter((m) => m.team === DOTA_GC_TEAM.BAD_GUYS)
      .map((m) => m.accountId);

    // 3) tell the platform who is in (only when it changed)
    if (!ctx.launched) {
      await this.broadcastRoster(ctx, inLobby, radiant, dire);
    }

    // 4) launch when both invited players sit on opposite sides
    const allIn = [...ctx.invited.keys()].every((acc) => inLobby.has(acc));
    const sidesOk =
      radiant.length === 1 &&
      dire.length === 1 &&
      ctx.invited.has(radiant[0]) &&
      ctx.invited.has(dire[0]);
    if (!ctx.launched && allIn && sidesOk) {
      ctx.launched = true;
      ctx.gameDeadline = now + this.config.gameTimeoutSeconds * 1000;
      ctx.radiantAcc = radiant[0];
      ctx.direAcc = dire[0];
      gc.launchPracticeLobby();
      this.logger.log(
        `Both on sides (R=${ctx.radiantAcc} D=${ctx.direAcc}) — launch!`,
      );
      await this.deps.duels.markLive(
        ctx.id,
        ctx.playerIdOf(ctx.radiantAcc)!,
        ctx.playerIdOf(ctx.direAcc)!,
      );
      this.startStatsPolling();
      return;
    }

    // 5) no-show
    if (!ctx.launched && now > ctx.joinDeadline) {
      const onSide = new Set([...radiant, ...dire]);
      const absent = ctx.players
        .filter((p) => !onSide.has(p.accountId))
        .map((p) => p.playerId);
      this.logger.warn(
        `No-show after ${this.config.joinTimeoutSeconds}s — absent: ${absent.join(', ') || 'none?'}`,
      );
      await this.deps.duels.applyNoShow(ctx.id, absent);
      await this.finish();
      return;
    }

    if (ctx.lobbyLostAt != null) {
      this.logger.log('Lobby is back');
      ctx.lobbyLostAt = null;
    }
    const lobbyOutcome = lobby.match_outcome ?? 0;
    if (
      lobby.state !== ctx.lastLobbyState ||
      lobbyOutcome !== ctx.lastLobbyOutcome
    ) {
      this.logger.log(
        `lobby state ${ctx.lastLobbyState ?? '-'}→${lobby.state} outcome=${lobbyOutcome} match=${lobby.match_id ?? '?'} server=${lobby.server_id ?? '?'}`,
      );
      ctx.lastLobbyState = lobby.state;
      ctx.lastLobbyOutcome = lobbyOutcome;
    }
    ctx.lastLobby = lobby;
    if (
      lobby.match_id &&
      lobby.match_id !== '0' &&
      lobby.match_id !== ctx.lastMatchId
    ) {
      ctx.lastMatchId = lobby.match_id;
      await this.deps.duels.saveMatchId(ctx.id, lobby.match_id);
    }
    if (
      lobby.server_id &&
      lobby.server_id !== '0' &&
      lobby.server_id !== ctx.lastServerId
    ) {
      ctx.lastServerId = lobby.server_id;
      await this.deps.duels.saveServerId(ctx.id, lobby.server_id);
    }

    if (ctx.launched && lobby.state === LobbyState.RUN) ctx.sawRun = true;

    // 6) game hung
    if (
      ctx.launched &&
      !ctx.finished &&
      ctx.gameDeadline != null &&
      now > ctx.gameDeadline &&
      !this.gameOver(ctx, lobby)
    ) {
      this.logger.error(
        `Game did not reach POSTGAME in time — FAILED (game_timeout)`,
      );
      await this.deps.duels.failDuel(ctx.id, DuelFailReason.GAME_TIMEOUT);
      await this.finish();
      return;
    }

    // 7) result — the lobby shows POSTGAME briefly and then drops back to UI,
    //    sometimes before match_outcome is filled in, so "game over" is
    //    "RUN was seen and the state is no longer RUN", whatever it is now.
    if (ctx.launched && !ctx.finished && this.gameOver(ctx, lobby)) {
      ctx.gameEndedAt ??= now;
      const outcome = lobby.match_outcome ?? 0;
      if (outcome === 0) {
        // Give the GC a moment to sign the match out; meanwhile the live
        // scoreboard may already show the winner.
        if (now - ctx.gameEndedAt < DUEL_RESULT_DELAY_SECONDS * 1000) return;
        if (ctx.lastServerId && this.deps.stats.enabled) {
          const raw = await this.deps.stats.fetch(ctx.lastServerId);
          const outcome = raw ? this.deps.stats.deriveOutcome1v1(raw) : null;
          if (raw && outcome != null) {
            await this.applyScoreboardResult(ctx, raw, outcome);
            return;
          }
        }
        ctx.postgameAt ??= now;
        if (now - ctx.postgameAt < DUEL_POSTGAME_OUTCOME_WAIT_SECONDS * 1000) {
          this.maybeRequestGcDetails(ctx, now);
          return;
        }
        this.logger.warn(
          `Game over without match_outcome for ${DUEL_POSTGAME_OUTCOME_WAIT_SECONDS}s — asking the Web API`,
        );
      }
      ctx.finished = true;
      await this.reportFromLobby(ctx, lobby);
    }
  }

  /**
   * Follows a running game through the server's live scoreboard (the bot is
   * no longer in the lobby). Records the result the moment the board shows a
   * winner by the 1v1 rules; when the server disappears, the last snapshot
   * decides, or the duel goes to admin review with those stats attached.
   */
  private async followGameByScoreboard(
    ctx: DuelCtx,
    now: number,
  ): Promise<void> {
    if (ctx.finished || !ctx.lastServerId) return;
    const raw = await this.deps.stats.fetch(ctx.lastServerId);

    if (raw) {
      ctx.lastStats = raw;
      ctx.serverSeenAt = now;
      ctx.serverMisses = 0;
      const outcome = this.deps.stats.deriveOutcome1v1(raw);
      if (outcome != null) {
        this.logger.log(
          `Result from the live scoreboard: outcome=${outcome} — ${this.deps.stats.describe(raw)}`,
        );
        await this.applyScoreboardResult(ctx, raw, outcome);
        return;
      }
      // Every change on the board (state, kills, heroes, towers) is logged;
      // an unchanged board only every FOLLOW_LOG_INTERVAL_MS.
      const line = this.deps.stats.describe(raw);
      if (
        line !== ctx.lastFollowLine ||
        now - ctx.lastFollowLogAt >= FOLLOW_LOG_INTERVAL_MS
      ) {
        ctx.lastFollowLogAt = now;
        ctx.lastFollowLine = line;
        this.logger.log(`following: ${line}`);
      }
      // The board says the game is over but shows no winner by the 1v1
      // rules (the final kill does not always reach the board): Valve's own
      // record of the match decides.
      const state = raw.match?.game_state ?? 0;
      if (state === 6 || state === 7) {
        await this.tryWebApi(ctx, now, `board in post game (state=${state})`);
      }
      return;
    }

    ctx.serverMisses += 1;
    // A silent board almost always means the game ended and the server is
    // shutting down — ask Valve for the match right away, every tick.
    if (await this.tryWebApi(ctx, now, `scoreboard miss ${ctx.serverMisses}`)) {
      return;
    }
    if (ctx.serverSeenAt != null) {
      const silentMs = now - ctx.serverSeenAt;
      if (ctx.serverMisses === 1) {
        this.logger.warn(
          `scoreboard ${ctx.lastServerId} stopped answering — asking the Web API for match ${ctx.lastMatchId ?? '?'} every ${WEB_API_POLL_MS / 1000}s; the server counts as gone after ${SERVER_GONE_AFTER_MS / 1000}s of silence`,
        );
      }
      if (
        ctx.serverMisses < SERVER_GONE_MIN_MISSES ||
        silentMs < SERVER_GONE_AFTER_MS
      ) {
        return;
      }
      // Server gone → the game is over.
      const last = ctx.lastStats;
      // 1) The last snapshot already shows a finished game by the 1v1 rules.
      const strict = last ? this.deps.stats.deriveOutcome1v1(last) : null;
      if (last && strict != null) {
        this.logger.log(
          `Server gone after ${Math.round(silentMs / 1000)}s of silence — result from the last snapshot: outcome=${strict} — ${this.deps.stats.describe(last)}`,
        );
        await this.applyScoreboardResult(ctx, last, strict);
        return;
      }
      // 2) Valve's record (asked every tick above) gets a little longer.
      if (ctx.serverGoneAt == null) {
        ctx.serverGoneAt = now;
        this.logger.warn(
          `Server gone after ${Math.round(silentMs / 1000)}s of silence, last snapshot shows no winner (${last ? this.deps.stats.describe(last) : 'no snapshot'}) — Web API asked ${ctx.webApiAttempts} time(s) so far, keeping on for up to ${WEB_API_WAIT_MS / 60_000} min`,
        );
      }
      if (ctx.lastMatchId && now - ctx.serverGoneAt < WEB_API_WAIT_MS) return;
      // 3) Valve has nothing: whoever led on kills won (the server does not
      //    vanish mid-game — a leaver or a "gg" ends it early). A tie goes to
      //    admin review; the recovery pass keeps asking the Web API for it.
      const leader = last
        ? this.deps.stats.deriveOutcome1v1(last, { gameOver: true })
        : null;
      if (last && leader != null) {
        this.logger.warn(
          `Web API has no record of match ${ctx.lastMatchId ?? '?'} after ${ctx.webApiAttempts} attempts — kill leader from the last snapshot decides: outcome=${leader} — ${this.deps.stats.describe(last)}`,
        );
        await this.applyScoreboardResult(ctx, last, leader);
        return;
      }
      this.logger.error(
        `Server gone, Web API has no record of match ${ctx.lastMatchId ?? '?'} (${ctx.webApiAttempts} attempts) and the last snapshot shows no winner — FAILED (undetermined_outcome): ${last ? this.deps.stats.describe(last) : 'no snapshot'}`,
      );
      ctx.finished = true;
      await this.deps.duels.failDuel(
        ctx.id,
        DuelFailReason.UNDETERMINED_OUTCOME,
        'server gone, scoreboard shows no winner',
      );
      if (last) {
        try {
          await this.deps.duels.saveStats(
            ctx.id,
            this.deps.stats.summarize(
              last,
              ctx.players.map((p) => ({
                playerId: p.playerId,
                steamId64: p.steamId64,
              })),
              null,
              ctx.radiantAcc,
              ctx.direAcc,
            ),
          );
        } catch {
          /* best effort */
        }
      }
      await this.finish();
      return;
    }

    // Never reached the server at all: give it the grace period (Valve's
    // record is still asked every tick above), then give up.
    if (now - (ctx.lobbyLostAt ?? now) < DUEL_LOBBY_LOST_GRACE_SECONDS * 1000) {
      if (ctx.serverMisses === 1) {
        this.logger.warn(
          `scoreboard ${ctx.lastServerId} unreachable — retrying`,
        );
      }
      return;
    }
    this.logger.error(
      `Scoreboard never reachable for ${DUEL_LOBBY_LOST_GRACE_SECONDS}s — FAILED (lobby_lost)`,
    );
    ctx.finished = true;
    await this.deps.duels.failDuel(
      ctx.id,
      DuelFailReason.LOBBY_LOST,
      'lobby gone, scoreboard unreachable',
    );
    await this.finish();
  }

  /**
   * Throttled `GetMatchDetails` for the match we follow. True when Valve had
   * the record and the result was applied — the duel is finished then.
   */
  private async tryWebApi(
    ctx: DuelCtx,
    now: number,
    why: string,
  ): Promise<boolean> {
    if (ctx.finished || !ctx.lastMatchId || !this.deps.stats.enabled) {
      return false;
    }
    if (now - ctx.webApiLastAt < WEB_API_POLL_MS) return false;
    ctx.webApiLastAt = now;
    ctx.webApiAttempts += 1;
    this.logger.log(
      `Web API attempt ${ctx.webApiAttempts} for match ${ctx.lastMatchId} — ${why}`,
    );
    const applied = await this.resolveFromWebApi(
      ctx.id,
      ctx.lastMatchId,
      ctx.participants,
    );
    if (!applied) return false;
    ctx.finished = true;
    await this.finish();
    return true;
  }

  /** Winner + stats + played heroes from one scoreboard snapshot → DuelsService. */
  private async applyScoreboardResult(
    ctx: DuelCtx,
    raw: RealtimeStatsRaw,
    outcome: number,
  ): Promise<void> {
    ctx.finished = true;
    const stats = this.deps.stats.summarize(
      raw,
      ctx.players.map((p) => ({
        playerId: p.playerId,
        steamId64: p.steamId64,
      })),
      outcome,
      ctx.radiantAcc,
      ctx.direAcc,
    );
    const heroesPlayed = stats.players
      .filter(
        (p): p is typeof p & { playerId: string; heroId: number } =>
          !!p.playerId && p.heroId != null && p.heroId > 0,
      )
      .map((p) => ({ playerId: p.playerId, heroId: p.heroId }));
    await this.applyResult(ctx, {
      matchId: ctx.lastMatchId,
      outcome,
      heroesPlayed,
      stats,
    });
  }

  /** Every 10 s after the delay: `MatchDetailsRequest` for the match we saw running. */
  private maybeRequestGcDetails(ctx: DuelCtx, now: number): void {
    const gc = this.gc;
    if (!gc?.ready || !ctx.lastMatchId || ctx.gameEndedAt == null) return;
    if (now - ctx.gameEndedAt < DUEL_RESULT_DELAY_SECONDS * 1000) return;
    if (now - ctx.gcDetailsLastAt < DUEL_GC_DETAILS_INTERVAL_SECONDS * 1000) {
      return;
    }
    ctx.gcDetailsLastAt = now;
    ctx.gcDetailsAttempts += 1;
    this.logger.log(
      `MatchDetailsRequest ${ctx.lastMatchId} (attempt ${ctx.gcDetailsAttempts})`,
    );
    gc.requestMatchDetails(ctx.lastMatchId);
  }

  /** GC answered a match-details request: record the result if it is ours and final. */
  private async onMatchDetails(details: GcMatchDetails): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || ctx.finished) return;
    const match = details.match;
    if (!match?.match_id || match.match_id !== ctx.lastMatchId) {
      this.logger.log(
        `GC match details: result=${details.result ?? '?'} match=${match?.match_id ?? 'none'} (ours: ${ctx.lastMatchId ?? '?'}) — ignored`,
      );
      // EResult 15 = AccessDenied: the GC will never hand this match out, stop asking.
      if (details.result === 15) ctx.gcDetailsLastAt = Number.MAX_SAFE_INTEGER;
      return;
    }
    const outcome = match.match_outcome ?? 0;
    if (outcome !== 2 && outcome !== 3) {
      this.logger.log(
        `GC match ${match.match_id}: result=${details.result ?? '?'} outcome=${outcome} — not final yet`,
      );
      return;
    }
    ctx.finished = true;
    const participants = ctx.players.map((p) => ({
      playerId: p.playerId,
      steamId64: p.steamId64,
    }));
    const heroesPlayed = (match.players ?? [])
      .map((p) => ({
        playerId: ctx.playerIdOf(p.account_id ?? null),
        heroId: p.hero_id ?? 0,
      }))
      .filter((h): h is { playerId: string; heroId: number } => !!h.playerId);
    this.logger.log(
      `GC match ${match.match_id} ✅ outcome=${outcome} duration=${match.duration ?? '?'}s`,
    );
    await this.applyResult(ctx, {
      matchId: match.match_id,
      outcome,
      heroesPlayed,
      stats: this.deps.stats.fromGcMatch(match, participants),
    });
  }

  /** Game finished from the GC's point of view: it ran, and the lobby is no longer running. */
  private gameOver(ctx: DuelCtx, lobby: GcLobby): boolean {
    if (lobby.state === LobbyState.POSTGAME) return true;
    return ctx.sawRun && lobby.state !== LobbyState.RUN;
  }

  /**
   * The end data Valve publishes for the match (`GetMatchDetails`): winner,
   * heroes, per-player stats. Applies it and returns true, or returns false
   * when Valve has no record (yet) — the caller decides what happens then.
   */
  private async resolveFromWebApi(
    duelId: string,
    matchId: string,
    participants: StatsParticipant[],
  ): Promise<boolean> {
    if (!this.deps.stats.enabled) {
      this.logger.warn(
        `Web API: STEAM_API_KEY is not set — cannot ask GetMatchDetails for match ${matchId}`,
      );
      return false;
    }
    this.logger.log(`Web API: asking GetMatchDetails for match ${matchId}`);
    const match = await this.deps.stats.fetchMatchDetails(matchId);
    if (!match) {
      this.logger.log(`Web API: no record of match ${matchId} yet`);
      return false;
    }
    const result = this.deps.stats.fromWebApiMatch(match, participants);
    this.logger.log(
      `Web API ✅ match_id=${matchId} outcome=${result.outcome} duration=${result.stats.durationSeconds ?? '?'}s — ${this.deps.stats.describeWebApi(match)}`,
    );
    this.logger.log(
      `Web API stats per duel player: ${result.stats.players
        .map(
          (p) =>
            `${p.playerId}(${p.steamId64}) side=${p.isRadiant == null ? '?' : p.isRadiant ? 'radiant' : 'dire'} win=${p.win ?? '?'} h${p.heroId ?? '?'} k${p.kills ?? '?'}/d${p.deaths ?? '?'}`,
        )
        .join(' | ')}`,
    );
    if (result.heroesPlayed.length) {
      this.logger.log(
        `heroes played: ${result.heroesPlayed.map((h) => `${h.playerId}=${h.heroId}`).join(', ')}`,
      );
    }
    const saved = await this.deps.duels.applyGcResult(duelId, {
      dotaMatchId: matchId,
      matchOutcome: result.outcome,
      heroesPlayed: result.heroesPlayed,
    });
    this.logger.log(
      `Duel ${duelId} → ${saved.state}${saved.failReason ? ` (${saved.failReason})` : ''} winner=${saved.winnerId ?? 'none'}`,
    );
    try {
      await this.deps.duels.saveStats(duelId, result.stats);
      this.logger.log(`Duel ${duelId}: Web API stats saved`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`stats not saved: ${message}`);
    }
    return true;
  }

  private async broadcastRoster(
    ctx: DuelCtx,
    inLobby: Set<number>,
    radiant: number[],
    dire: number[],
  ): Promise<void> {
    const sideOf = (acc: number): DuelLobbySide =>
      radiant.includes(acc)
        ? 'radiant'
        : dire.includes(acc)
          ? 'dire'
          : 'unassigned';
    const players: DuelLobbyPlayer[] = ctx.players.map((p) => {
      const present = inLobby.has(p.accountId);
      return {
        playerId: p.playerId,
        steamId64: p.steamId64,
        present,
        side: present ? sideOf(p.accountId) : null,
      };
    });
    const sig = players.map((p) => `${p.present}:${p.side}`).join('|');
    if (sig === ctx.lastRosterSig) return;
    ctx.lastRosterSig = sig;
    await this.deps.duels.updateLobbyPlayers(ctx.id, players);
  }

  /** The lobby itself carried the outcome (POSTGAME with match_outcome). */
  private async reportFromLobby(ctx: DuelCtx, lobby: GcLobby): Promise<void> {
    const matchId =
      lobby.match_id && lobby.match_id !== '0'
        ? lobby.match_id
        : ctx.lastMatchId;
    let outcome = lobby.match_outcome ?? 0;
    if (outcome === 0 && matchId && this.deps.stats.enabled) {
      outcome = (await this.deps.stats.fetchMatchOutcome(matchId)) ?? 0;
    }
    this.logger.log(`POSTGAME ✅ match_id=${matchId} outcome=${outcome}`);

    // Heroes actually played: the lobby members carry hero_id after the pick.
    const heroesPlayed = (lobby.all_members ?? [])
      .filter((m) => !!m.id)
      .map((m) => ({
        playerId: ctx.playerIdOf(accountIdOf(m.id)),
        heroId: m.hero_id ?? 0,
      }))
      .filter((h): h is { playerId: string; heroId: number } => !!h.playerId);

    // Final scoreboard: the server may live a few more seconds after the game.
    let stats: DuelStats | null = null;
    try {
      const raw =
        (ctx.lastServerId
          ? await this.deps.stats.fetch(ctx.lastServerId)
          : null) ?? ctx.lastStats;
      if (raw) {
        stats = this.deps.stats.summarize(
          raw,
          ctx.players.map((p) => ({
            playerId: p.playerId,
            steamId64: p.steamId64,
          })),
          outcome || null,
          ctx.radiantAcc,
          ctx.direAcc,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`live stats not available: ${message}`);
    }

    await this.applyResult(ctx, { matchId, outcome, heroesPlayed, stats });
  }

  /** Writes the result (+ stats) through DuelsService and frees the bot. */
  private async applyResult(
    ctx: DuelCtx,
    result: {
      matchId: string | null;
      outcome: number;
      heroesPlayed: Array<{ playerId: string; heroId: number }>;
      stats: DuelStats | null;
    },
  ): Promise<void> {
    this.stopStatsPolling();
    if (result.heroesPlayed.length) {
      this.logger.log(
        `heroes played: ${result.heroesPlayed.map((h) => `${h.playerId}=${h.heroId}`).join(', ')}`,
      );
    }
    const saved = await this.deps.duels.applyGcResult(ctx.id, {
      dotaMatchId: result.matchId,
      matchOutcome: result.outcome,
      heroesPlayed: result.heroesPlayed,
    });
    this.logger.log(
      `Duel ${ctx.id} → ${saved.state}${saved.failReason ? ` (${saved.failReason})` : ''} match=${result.matchId ?? '?'} outcome=${result.outcome} winner=${saved.winnerId ?? 'none'} loser=${saved.loserId ?? 'none'}`,
    );
    if (result.stats) {
      this.logger.log(
        `stats: duration=${result.stats.durationSeconds ?? '?'}s ${result.stats.players
          .map(
            (p) =>
              `${p.playerId ?? '?'}(${p.steamId64}) side=${p.isRadiant == null ? '?' : p.isRadiant ? 'radiant' : 'dire'} win=${p.win ?? '?'} h${p.heroId ?? '?'} k${p.kills ?? '?'}/d${p.deaths ?? '?'} lh${p.lastHits ?? '?'} nw${p.netWorth ?? '?'} lvl${p.level ?? '?'}`,
          )
          .join(' | ')}`,
      );
      try {
        await this.deps.duels.saveStats(ctx.id, result.stats);
        this.logger.log(`Duel ${ctx.id}: stats saved`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`stats not saved: ${message}`);
      }
    }
    await this.finish();
  }

  // ── live stats ───────────────────────────────────────────────────────────

  private startStatsPolling(): void {
    if (!this.deps.stats.enabled || this.statsTimer) return;
    const poll = async () => {
      const ctx = this.ctx;
      const lobby = this.gc?.lobby;
      if (!ctx || ctx.finished) return;
      const serverId =
        lobby?.server_id && lobby.server_id !== '0'
          ? lobby.server_id
          : ctx.lastServerId;
      if (!serverId) return;
      ctx.lastServerId = serverId;
      const raw = await this.deps.stats.fetch(serverId);
      if (raw) ctx.lastStats = raw;
    };
    this.statsTimer = setInterval(() => void poll(), this.config.statsPollMs);
    void poll();
  }

  private stopStatsPolling(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  // ── cleanup ──────────────────────────────────────────────────────────────

  /** Leave the lobby and make the bot available again. */
  private async finish(): Promise<void> {
    this.stopStatsPolling();
    const gc = this.gc;
    if (gc?.lobby) {
      try {
        gc.leaveLobby();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`leave lobby failed: ${message}`);
      }
    }
    this.ctx = null;
    await this.setStatus(
      this.gcReady ? HostBotStatus.FREE : HostBotStatus.OFFLINE,
    );
  }
}
