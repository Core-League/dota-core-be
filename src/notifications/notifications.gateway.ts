import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import { getCorsOrigins } from '../config/cors';
import type { DuelEvent } from '../duels/duel-events';
import {
  authenticateSocket,
  playerRoom,
  type PlayerSocket,
} from '../realtime/socket-auth';
import { NOTIFICATION_SOCKET_NAMESPACE } from './notification.constants';
import { NotificationsService } from './notifications.service';

/** Server → client events. Mirrored by `INotificationSocketServerEvents` on the frontend. */
const EVENT_SNAPSHOT = 'notification:snapshot';
const EVENT_ERROR = 'notification:error';

/**
 * Real-time channel of the header bell: `<api>/notifications`, same bearer
 * JWT handshake as `/duels`. The full snapshot (newest entries + unread
 * counter) is pushed on connect and after every change announced on the
 * duel event bus with `scope: 'notification'`. Unlike the duels socket it
 * has no side effects, so the frontend keeps it open for the whole session.
 */
@WebSocketGateway({
  namespace: NOTIFICATION_SOCKET_NAMESPACE,
  cors: {
    origin: getCorsOrigins(),
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() private readonly server!: Namespace;
  private readonly logger = new Logger(NotificationsGateway.name);
  /** Connected socket ids per player — several tabs are several sockets. */
  private readonly socketsByPlayer = new Map<string, Set<string>>();

  constructor(
    private readonly notifications: NotificationsService,
    private readonly jwt: JwtService,
  ) {}

  async handleConnection(client: PlayerSocket): Promise<void> {
    const playerId = await authenticateSocket(client, this.jwt);
    if (!playerId) {
      client.emit(EVENT_ERROR, { error: 'unauthorized' });
      client.disconnect(true);
      return;
    }
    client.data.playerId = playerId;
    await client.join(playerRoom(playerId));
    let set = this.socketsByPlayer.get(playerId);
    if (!set) {
      set = new Set();
      this.socketsByPlayer.set(playerId, set);
    }
    set.add(client.id);
    await this.push(playerId, client);
  }

  handleDisconnect(client: PlayerSocket): void {
    const playerId = client.data.playerId;
    if (!playerId) return;
    const set = this.socketsByPlayer.get(playerId);
    if (!set) return;
    set.delete(client.id);
    if (!set.size) this.socketsByPlayer.delete(playerId);
  }

  /** An inbox changed (announced by any process): connected owners get a fresh snapshot. */
  onEvent(event: DuelEvent): void {
    if (event.scope !== 'notification') return;
    for (const playerId of event.playerIds) {
      if (this.socketsByPlayer.has(playerId)) void this.push(playerId);
    }
  }

  private async push(playerId: string, only?: PlayerSocket): Promise<void> {
    try {
      const snapshot = await this.notifications.snapshot(playerId);
      if (only) only.emit(EVENT_SNAPSHOT, snapshot);
      else this.server.to(playerRoom(playerId)).emit(EVENT_SNAPSHOT, snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`snapshot push to ${playerId} failed: ${message}`);
    }
  }
}
