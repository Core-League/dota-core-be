import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import { Logger } from '@nestjs/common';
import SteamUser from 'steam-user';
import {
  DOTA_APP_ID,
  DOTA_GAMEMODE_1V1MID,
  DOTA_GC_TEAM,
  EDOTAGCMsg,
  EGCBaseClientMsg,
  ESE_SOURCE2,
  ESOMsg,
  GCConnectionStatus,
  LOBBY_VISIBILITY_UNLISTED,
  SO_TYPE_LOBBY,
  decode,
  encode,
  type GcLobby,
  type GcMatchDetails,
} from './dota-gc.protocol';

const HELLO_INTERVAL_MS = 5_000;

export interface DotaGcClientOptions {
  accountName: string;
  password: string;
  label: string;
}

export interface CreateLobbyOptions {
  gameName: string;
  passKey: string;
  serverRegion: number;
  /** `DOTA_GameMode`; defaults to 1v1 Solo Mid. */
  gameMode?: number;
}

interface SoObject {
  type_id: number;
  object_data: Buffer;
}

/**
 * One Steam account talking to the Dota 2 Game Coordinator through
 * `steam-user`. Owns the login, the GC hello/welcome handshake and a mirror
 * of the shared-object cache limited to the lobby object. Emits:
 *   `ready` / `notReady`  — GC session up / down
 *   `lobbyNew`(lobby)     — a lobby object appeared in the cache
 *   `lobbyChanged`(lobby) — the lobby object was updated
 *   `lobbyRemoved`()      — the lobby object was removed
 *   `disconnected`(eresult, msg), `fatal`(error)
 */
export class DotaGcClient extends EventEmitter {
  private readonly logger: Logger;
  private readonly user: SteamUser;
  private helloTimer: NodeJS.Timeout | null = null;
  private _ready = false;
  private _loggedOn = false;
  private _lobby: GcLobby | null = null;
  private stopped = false;

  constructor(private readonly opts: DotaGcClientOptions) {
    super();
    this.logger = new Logger(`GC:${opts.label}`);
    this.user = new SteamUser({ dataDirectory: null, autoRelogin: true });
    this.wire();
  }

  get ready(): boolean {
    return this._ready;
  }

  get loggedOn(): boolean {
    return this._loggedOn;
  }

  get lobby(): GcLobby | null {
    return this._lobby;
  }

  get steamId64(): string | null {
    return this.user.steamID?.getSteamID64() ?? null;
  }

  get accountId(): number | null {
    return this.user.steamID?.accountid ?? null;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  logOn(): void {
    this.stopped = false;
    this.logger.log('Logging into Steam…');
    this.user.logOn({
      accountName: this.opts.accountName,
      password: this.opts.password,
      logonID: randomInt(1, 0x7fffffff),
      machineName: 'core-league-hostbot',
    });
  }

  logOff(): void {
    this.stopped = true;
    this.stopHello();
    this._ready = false;
    try {
      this.user.logOff();
    } catch {
      /* already offline */
    }
  }

  private wire(): void {
    this.user.on('loggedOn', () => {
      this._loggedOn = true;
      this.logger.log(`Steam OK (${this.steamId64}). Launching Dota 2…`);
      this.user.setPersona(SteamUser.EPersonaState.Online);
      this.user.gamesPlayed([DOTA_APP_ID]);
    });

    this.user.on('appLaunched', (appid: number) => {
      if (appid !== DOTA_APP_ID) return;
      this.startHello();
    });

    this.user.on('disconnected', (eresult: number, msg?: string) => {
      this._loggedOn = false;
      this.setReady(false, `disconnected (${eresult} ${msg ?? ''})`);
      this.emit('disconnected', eresult, msg);
    });

    this.user.on('error', (err: Error & { eresult?: number }) => {
      this._loggedOn = false;
      this.setReady(false, `steam error: ${err.message}`);
      this.emit('fatal', err);
    });

    this.user.on('steamGuard', () => {
      // The worker has no 2FA flow — the account must have Steam Guard disabled.
      const err = new Error('steam_guard_required');
      this.logger.error(
        'Steam Guard challenge received — disable Steam Guard on this account',
      );
      this.emit('fatal', err);
      this.logOff();
    });

    this.user.on(
      'receivedFromGC',
      (appid: number, msgType: number, payload: Buffer) => {
        if (appid !== DOTA_APP_ID) return;
        try {
          this.handleGcMessage(msgType, payload);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`GC message ${msgType} failed to parse: ${message}`);
        }
      },
    );
  }

  // ── GC session ───────────────────────────────────────────────────────────

  private startHello(): void {
    this.stopHello();
    const sendHello = () => {
      if (this.stopped || this._ready || !this._loggedOn) return;
      this.send(
        EGCBaseClientMsg.ClientHello,
        encode('CMsgClientHello', {
          engine: ESE_SOURCE2,
          client_session_need: 104,
        }),
      );
    };
    sendHello();
    this.helloTimer = setInterval(sendHello, HELLO_INTERVAL_MS);
  }

  private stopHello(): void {
    if (this.helloTimer) {
      clearInterval(this.helloTimer);
      this.helloTimer = null;
    }
  }

  private setReady(ready: boolean, reason?: string): void {
    if (this._ready === ready) return;
    this._ready = ready;
    if (ready) {
      this.logger.log('GC ready ✅');
      this.stopHello();
      this.emit('ready');
    } else {
      this.logger.warn(`GC not ready (${reason ?? 'unknown'})`);
      this._lobby = null;
      this.emit('notReady', reason);
      if (this._loggedOn && !this.stopped) this.startHello();
    }
  }

  private send(msgType: number, payload: Buffer): void {
    this.user.sendToGC(DOTA_APP_ID, msgType, {}, payload);
  }

  private handleGcMessage(msgType: number, payload: Buffer): void {
    switch (msgType) {
      case EGCBaseClientMsg.ClientWelcome: {
        const welcome = decode<{
          outofdate_subscribed_caches?: Array<{
            objects?: Array<{ type_id: number; object_data: Buffer[] }>;
          }>;
        }>('CMsgClientWelcome', payload);
        for (const cache of welcome.outofdate_subscribed_caches ?? []) {
          this.applySubscribed(cache.objects ?? []);
        }
        this.setReady(true);
        return;
      }
      case EGCBaseClientMsg.ClientConnectionStatus: {
        const status = decode<{ status?: number }>(
          'CMsgConnectionStatus',
          payload,
        );
        if ((status.status ?? 0) !== GCConnectionStatus.HAVE_SESSION) {
          this.setReady(false, `connection status ${status.status}`);
        } else {
          this.setReady(true);
        }
        return;
      }
      case ESOMsg.CacheSubscribed: {
        const msg = decode<{
          objects?: Array<{ type_id: number; object_data: Buffer[] }>;
        }>('CMsgSOCacheSubscribed', payload);
        this.applySubscribed(msg.objects ?? []);
        return;
      }
      case ESOMsg.CacheUnsubscribed: {
        // The GC unsubscribes us from several caches (party, our own account
        // cache, ...) — only the lobby's own cache means the lobby is gone.
        const msg = decode<{ owner_soid?: { type?: number; id?: string } }>(
          'CMsgSOCacheUnsubscribed',
          payload,
        );
        const ownerId = msg.owner_soid?.id;
        if (!this._lobby) return;
        if (ownerId && ownerId !== this._lobby.lobby_id) {
          this.logger.log(
            `SO cache ${msg.owner_soid?.type ?? '?'}/${ownerId} unsubscribed — not the lobby, keeping it`,
          );
          return;
        }
        this.logger.log(
          `SO cache unsubscribed for lobby ${this._lobby.lobby_id} — lobby removed`,
        );
        this._lobby = null;
        this.emit('lobbyRemoved');
        return;
      }
      case ESOMsg.Create:
      case ESOMsg.Update: {
        const msg = decode<SoObject>('CMsgSOSingleObject', payload);
        this.applyObject(msg, msgType === ESOMsg.Create ? 'create' : 'update');
        return;
      }
      case ESOMsg.Destroy: {
        const msg = decode<SoObject>('CMsgSOSingleObject', payload);
        if (msg.type_id === SO_TYPE_LOBBY && this._lobby) {
          this._lobby = null;
          this.emit('lobbyRemoved');
        }
        return;
      }
      case ESOMsg.UpdateMultiple: {
        const msg = decode<{
          objects_modified?: SoObject[];
          objects_added?: SoObject[];
          objects_removed?: SoObject[];
        }>('CMsgSOMultipleObjects', payload);
        for (const o of msg.objects_added ?? []) this.applyObject(o, 'create');
        for (const o of msg.objects_modified ?? [])
          this.applyObject(o, 'update');
        for (const o of msg.objects_removed ?? []) {
          if (o.type_id === SO_TYPE_LOBBY && this._lobby) {
            this._lobby = null;
            this.emit('lobbyRemoved');
          }
        }
        return;
      }
      case EDOTAGCMsg.MatchDetailsResponse: {
        const details = decode<GcMatchDetails>(
          'CMsgGCMatchDetailsResponse',
          payload,
        );
        this.emit('matchDetails', details);
        return;
      }
      default:
        this.logger.debug?.(
          `GC message ${msgType} ignored (${payload.length} bytes)`,
        );
    }
  }

  /** Ask the GC for a finished match by id; the answer arrives as the `matchDetails` event. */
  requestMatchDetails(matchId: string): void {
    this.send(
      EDOTAGCMsg.MatchDetailsRequest,
      encode('CMsgGCMatchDetailsRequest', { match_id: matchId }),
    );
  }

  private applySubscribed(
    objects: Array<{ type_id: number; object_data: Buffer[] }>,
  ): void {
    for (const group of objects) {
      if (group.type_id !== SO_TYPE_LOBBY) {
        this.logger.debug?.(
          `SO cache type ${group.type_id}: ${group.object_data?.length ?? 0} object(s)`,
        );
        continue;
      }
      for (const data of group.object_data ?? []) {
        this.applyObject(
          { type_id: group.type_id, object_data: data },
          'create',
        );
      }
    }
  }

  private applyObject(obj: SoObject, kind: 'create' | 'update'): void {
    if (obj.type_id !== SO_TYPE_LOBBY) {
      this.logger.debug?.(`SO ${kind} type ${obj.type_id} ignored`);
      return;
    }
    const lobby = decode<GcLobby>('CSODOTALobby', obj.object_data);
    const isNew =
      this._lobby == null || this._lobby.lobby_id !== lobby.lobby_id;
    this._lobby = lobby;
    this.emit(isNew ? 'lobbyNew' : 'lobbyChanged', lobby);
  }

  // ── lobby commands ───────────────────────────────────────────────────────

  createPracticeLobby(opts: CreateLobbyOptions): void {
    const details = {
      game_name: opts.gameName.slice(0, 63),
      server_region: opts.serverRegion,
      game_mode: opts.gameMode ?? DOTA_GAMEMODE_1V1MID,
      allow_cheats: false,
      fill_with_bots: false,
      allow_spectating: true,
      pass_key: opts.passKey,
      visibility: LOBBY_VISIBILITY_UNLISTED,
    };
    this.send(
      EDOTAGCMsg.PracticeLobbyCreate,
      encode('CMsgPracticeLobbyCreate', {
        pass_key: opts.passKey,
        lobby_details: details,
      }),
    );
  }

  /** Move the bot itself to a team; `PLAYER_POOL` keeps it out of the two game slots. */
  setTeamSlot(team: number = DOTA_GC_TEAM.PLAYER_POOL, slot = 1): void {
    this.send(
      EDOTAGCMsg.PracticeLobbySetTeamSlot,
      encode('CMsgPracticeLobbySetTeamSlot', { team, slot }),
    );
  }

  /**
   * Take a broadcaster (caster) seat. Broadcasters do stay lobby members
   * through the launch, but the game server waits for them on the loading
   * screen and aborts the match (~45 s, lobby back to UI, no match id) when
   * a headless bot never connects — so the host bot must NOT use this while
   * hosting a game. Kept for tooling / experiments only.
   */
  joinBroadcastChannel(channel = 1): void {
    this.send(
      EDOTAGCMsg.PracticeLobbyJoinBroadcastChannel,
      encode('CMsgPracticeLobbyJoinBroadcastChannel', {
        channel,
        preferred_description: 'Core League',
      }),
    );
  }

  inviteToLobby(steamId64: string): void {
    this.send(
      EDOTAGCMsg.InviteToLobby,
      encode('CMsgInviteToLobby', { steam_id: steamId64 }),
    );
  }

  kick(accountId: number): void {
    this.send(
      EDOTAGCMsg.PracticeLobbyKick,
      encode('CMsgPracticeLobbyKick', { account_id: accountId }),
    );
  }

  launchPracticeLobby(): void {
    this.send(
      EDOTAGCMsg.PracticeLobbyLaunch,
      encode('CMsgPracticeLobbyLaunch', {}),
    );
  }

  /** The host leaving an otherwise empty practice lobby destroys it. */
  leaveLobby(): void {
    this.send(
      EDOTAGCMsg.PracticeLobbyLeave,
      encode('CMsgPracticeLobbyLeave', {}),
    );
  }
}
