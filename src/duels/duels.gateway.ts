import { Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { getCorsOrigins } from '../config/cors';
import {
  DUEL_SOCKET_HEARTBEAT_SECONDS,
  DUEL_SOCKET_NAMESPACE,
  DUEL_SOCKET_REFRESH_DEBOUNCE_MS,
} from './duel.constants';
import type { DuelEvent } from './duel-events';
import { DuelsService } from './duels.service';

/** `socket.data` is typed through the 4th generic; the first three keep socket.io's defaults. */
type DuelSocket = Socket<any, any, any, { playerId?: string }>;

/** Server → client events. Mirrored by `IDuelSocketServerEvents` on the frontend. */
const EVENT_STATUS = 'duel:status';
const EVENT_ERROR = 'duel:error';

const roomOf = (playerId: string) => `player:${playerId}`;

/**
 * Real-time channel of the duels page: `<api>/duels`, authenticated with the
 * same bearer JWT as the REST API (`handshake.auth.token`). Each player gets
 * a room; the current `DuelStatusDto` is pushed on connect and again every
 * time `DuelEventsListener` reports a change that concerns them. A connected
 * socket also acts as the queue heartbeat, so the page no longer has to poll
 * `GET /duels/me` — a closed tab still drops out of the queue after the TTL.
 */
@WebSocketGateway({
  namespace: DUEL_SOCKET_NAMESPACE,
  cors: {
    origin: getCorsOrigins(),
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },
})
export class DuelsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer() private readonly server!: Namespace;
  private readonly logger = new Logger(DuelsGateway.name);
  /** Connected socket ids per player — several tabs are several sockets. */
  private readonly socketsByPlayer = new Map<string, Set<string>>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly pendingRefresh = new Set<string>();
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly duels: DuelsService,
    private readonly jwt: JwtService,
  ) {}

  afterInit(): void {
    this.heartbeatTimer = setInterval(
      () => void this.heartbeat(),
      DUEL_SOCKET_HEARTBEAT_SECONDS * 1000,
    );
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.heartbeatTimer = null;
    this.refreshTimer = null;
  }

  // ── connections ──────────────────────────────────────────────────────────

  async handleConnection(client: DuelSocket): Promise<void> {
    const playerId = await this.authenticate(client);
    if (!playerId) {
      client.emit(EVENT_ERROR, { error: 'unauthorized' });
      client.disconnect(true);
      return;
    }
    client.data.playerId = playerId;
    await client.join(roomOf(playerId));
    let set = this.socketsByPlayer.get(playerId);
    if (!set) {
      set = new Set();
      this.socketsByPlayer.set(playerId, set);
    }
    set.add(client.id);
    // First snapshot doubles as the heartbeat (touches the queue row).
    try {
      client.emit(EVENT_STATUS, await this.duels.getStatus(playerId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`status for ${playerId} on connect failed: ${message}`);
    }
  }

  handleDisconnect(client: DuelSocket): void {
    const playerId = client.data.playerId;
    if (!playerId) return;
    const set = this.socketsByPlayer.get(playerId);
    if (!set) return;
    set.delete(client.id);
    if (!set.size) this.socketsByPlayer.delete(playerId);
  }

  private async authenticate(client: DuelSocket): Promise<string | null> {
    const token = extractToken(client);
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      // Access tokens carry no `typ`; OAuth-state / Steam-link tokens do and are not logins.
      if (payload.typ) return null;
      return payload.sub || null;
    } catch {
      return null;
    }
  }

  // ── pushes ───────────────────────────────────────────────────────────────

  /** A ladder change was announced (by any process): refresh the players it concerns. */
  onEvent(event: DuelEvent): void {
    switch (event.scope) {
      case 'queue':
      case 'bots':
        this.scheduleRefresh([...this.socketsByPlayer.keys()]);
        return;
      case 'players':
        this.scheduleRefresh(event.playerIds);
        return;
      case 'duel':
        void this.duels
          .findDuelPlayerIds(event.duelId)
          .then((ids) => this.scheduleRefresh(ids))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`duel ${event.duelId} lookup failed: ${message}`);
          });
    }
  }

  /** Only connected players are refreshed; bursts (the worker writes several rows in a row) are merged. */
  private scheduleRefresh(playerIds: string[]): void {
    for (const id of playerIds) {
      if (this.socketsByPlayer.has(id)) this.pendingRefresh.add(id);
    }
    if (!this.pendingRefresh.size || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.flushRefresh();
    }, DUEL_SOCKET_REFRESH_DEBOUNCE_MS);
  }

  private async flushRefresh(): Promise<void> {
    const ids = [...this.pendingRefresh];
    this.pendingRefresh.clear();
    await Promise.all(
      ids.map(async (playerId) => {
        try {
          const status = await this.duels.getStatus(playerId, {
            touch: false,
          });
          this.server.to(roomOf(playerId)).emit(EVENT_STATUS, status);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`status push to ${playerId} failed: ${message}`);
        }
      }),
    );
  }

  /** Connected players stay in the queue; the matchmaker prunes everyone else after the TTL. */
  private async heartbeat(): Promise<void> {
    const ids = [...this.socketsByPlayer.keys()];
    if (!ids.length) return;
    try {
      await this.duels.touchQueue(ids);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`queue heartbeat failed: ${message}`);
    }
  }
}

/** `auth: { token }` (socket.io-client), or a bearer header / `?token=` for other clients. */
function extractToken(client: DuelSocket): string | null {
  const auth = client.handshake.auth as Record<string, unknown> | undefined;
  if (typeof auth?.token === 'string' && auth.token) return auth.token;
  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || null;
  }
  const query = client.handshake.query.token;
  return typeof query === 'string' && query ? query : null;
}
