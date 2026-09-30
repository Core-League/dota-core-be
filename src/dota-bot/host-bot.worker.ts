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
import type {
  RealtimeStatsRaw,
  RealtimeStatsService,
} from './realtime-stats.service';

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
 * The bot sits in `PLAYER_POOL`: it is the lobby host but never takes one of
 * the two game slots (the GC ignores `SPECTATOR` for the host).
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
    if (
      duel.state === DuelState.LOBBY_CREATING ||
      !duel.lobbyId ||
      !lobby ||
      lobby.lobby_id !== duel.lobbyId
    ) {
      if (duel.state === DuelState.LOBBY_CREATING) {
        this.logger.warn(
          `Duel ${duel.id} was mid-creation — releasing it back to PENDING`,
        );
        await this.deps.duels.releaseClaim(duel.id);
      } else if (
        duel.state === DuelState.LIVE &&
        duel.dotaMatchId &&
        (await this.resolveFromWebApi(duel.id, duel.dotaMatchId))
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
    this.ctx = ctx;
    this.logger.log(
      `Re-adopted duel ${duel.id} (${duel.state}) in lobby ${lobby.lobby_id}`,
    );
    await this.setStatus(HostBotStatus.BUSY);
    if (ctx.launched) this.startStatsPolling();
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
        // The GC drops the lobby from our cache the moment the match ends
        // (the bot is not in the game), so "lobby gone after launch" is
        // normally "the game just finished". The result then comes from the
        // GC's match details: asked 5 s later, re-asked every 10 s. Only when
        // the whole grace period yields nothing do we try the Web API once
        // and fail the duel for the background recovery / an admin.
        if (ctx.lobbyLostAt == null) {
          ctx.lobbyLostAt = now;
          ctx.gameEndedAt ??= now;
          this.logger.warn(
            `Lobby vanished after launch — asking the GC for match ${ctx.lastMatchId ?? '?'} in ${DUEL_RESULT_DELAY_SECONDS}s`,
          );
          return;
        }
        if (now - ctx.lobbyLostAt < DUEL_LOBBY_LOST_GRACE_SECONDS * 1000) {
          this.maybeRequestGcDetails(ctx, now);
          return;
        }
        if (
          ctx.lastMatchId &&
          (await this.resolveFromWebApi(ctx.id, ctx.lastMatchId))
        ) {
          ctx.finished = true;
          await this.finish();
          return;
        }
        this.logger.error(`Lobby vanished mid-game — FAILED (lobby_lost)`);
        await this.deps.duels.failDuel(ctx.id, DuelFailReason.LOBBY_LOST);
        await this.finish();
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
    const members = (lobby.all_members ?? []).map((m) => ({
      accountId: accountIdOf(m.id),
      team: m.team,
    }));
    const inLobby = new Set(members.map((m) => m.accountId));

    // 1) keep the bot out of the game slots
    const me = members.find((m) => m.accountId === botAcc);
    if (me && me.team !== DOTA_GC_TEAM.PLAYER_POOL) {
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
    if (
      lobby.match_id &&
      lobby.match_id !== '0' &&
      lobby.match_id !== ctx.lastMatchId
    ) {
      ctx.lastMatchId = lobby.match_id;
      await this.deps.duels.saveMatchId(ctx.id, lobby.match_id);
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
      // Give the GC a moment to sign the match out before we record anything.
      if (now - ctx.gameEndedAt < DUEL_RESULT_DELAY_SECONDS * 1000) return;
      const outcome = lobby.match_outcome ?? 0;
      if (outcome === 0) {
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
      this.logger.debug?.(
        `match details for ${match?.match_id ?? '?'} ignored (ours: ${ctx.lastMatchId ?? '?'})`,
      );
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
   * Last resort when the GC lobby is gone: `GetMatchDetails` by match id.
   * Applies the result and returns true, or returns false when Valve has no
   * outcome (yet) — the caller then fails the duel for admin review.
   */
  private async resolveFromWebApi(
    duelId: string,
    matchId: string,
  ): Promise<boolean> {
    if (!this.deps.stats.enabled) return false;
    const outcome = await this.deps.stats.fetchMatchOutcome(matchId);
    if (outcome == null) return false;
    this.logger.log(`Web API ✅ match_id=${matchId} outcome=${outcome}`);
    await this.deps.duels.applyGcResult(duelId, {
      dotaMatchId: matchId,
      matchOutcome: outcome,
    });
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
    await this.deps.duels.applyGcResult(ctx.id, {
      dotaMatchId: result.matchId,
      matchOutcome: result.outcome,
      heroesPlayed: result.heroesPlayed,
    });
    if (result.stats) {
      try {
        await this.deps.duels.saveStats(ctx.id, result.stats);
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
        lobby?.server_id && lobby.server_id !== '0' ? lobby.server_id : null;
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
