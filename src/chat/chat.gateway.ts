import { Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import type { Namespace, Socket } from 'socket.io';
import { getCorsOrigins } from '../config/cors';
import {
  authenticateSocket,
  extractSocketToken,
  playerRoom,
} from '../realtime/socket-auth';
import { ChatAccessEvents } from './chat-access.events';
import { ChatAccessService, type ChatViewer } from './chat-access.service';
import {
  CHAT_ACCESS_CACHE_MS,
  CHAT_COMMANDS,
  CHAT_EVENTS,
  CHAT_ONLINE_MENTION_COOLDOWN_MS,
  CHAT_PRESENCE_GRACE_MS,
  CHAT_PRESENCE_WATCH_MAX,
  CHAT_PUBLIC_KINDS,
  CHAT_PUBLIC_ROOM,
  CHAT_RATE_LIMIT,
  CHAT_ROOMS,
  CHAT_SOCKET_NAMESPACE,
  CHAT_TYPING_THROTTLE_MS,
  CHAT_VIP_EXPIRY_SWEEP_MS,
  ChatChannelKind,
  hasOnlineMention,
  isPublicKind,
  isUuid,
  parseChannelKey,
} from './chat.constants';
import { ChatError, ChatService, type ChatAudience } from './chat.service';
import type { ChatMessageDto } from './dto/chat.dto';

type ChatSocket = Socket<
  any,
  any,
  any,
  {
    playerId?: string;
    viewer?: ChatViewer | null;
    viewerAt?: number;
    /** Settles when the handshake has resolved the viewer; commands wait for it. */
    ready?: Promise<void>;
  }
>;

type ChatAck<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; message: string };

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {};
}

/**
 * Real-time channel of the site chat: `<api>/chat`. Unlike `/duels` and
 * `/notifications` a token is optional — guests connect read-only and only
 * join the General room. Logged-in sockets join the rooms their access
 * allows (re-evaluated when `ChatAccessEvents` reports a team / role change)
 * plus their `player:<id>` room, which carries DMs, their admin thread, read
 * markers and unread summaries. Sending, deleting, typing and read markers
 * are socket commands answered through the ack; history is REST.
 */
@WebSocketGateway({
  namespace: CHAT_SOCKET_NAMESPACE,
  cors: {
    origin: getCorsOrigins(),
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },
})
export class ChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer() private readonly server!: Namespace;
  private readonly logger = new Logger(ChatGateway.name);
  /** Connected socket ids per player — several tabs are several sockets. */
  private readonly socketsByPlayer = new Map<string, Set<string>>();
  /** Players whose last socket closed recently: still shown online until the timer fires. */
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();
  /** Presence subscriptions: watched player → watching socket ids, and back. */
  private readonly watchersOf = new Map<string, Set<string>>();
  private readonly watchedBy = new Map<string, Set<string>>();
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly lastTyping = new Map<string, number>();
  /** Last `@online` of a player: one per `CHAT_ONLINE_MENTION_COOLDOWN_MS` (admins are exempt). */
  private readonly lastOnlineMention = new Map<string, number>();
  private accessSubscription: Subscription | null = null;
  private vipSweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly chat: ChatService,
    private readonly access: ChatAccessService,
    private readonly accessEvents: ChatAccessEvents,
    private readonly jwt: JwtService,
  ) {}

  afterInit(): void {
    this.accessSubscription = this.accessEvents.changes.subscribe((ids) => {
      void this.refreshAccess(ids);
    });
    this.vipSweepTimer = setInterval(
      () => void this.sweepExpiredVip(),
      CHAT_VIP_EXPIRY_SWEEP_MS,
    );
  }

  onModuleDestroy(): void {
    this.accessSubscription?.unsubscribe();
    if (this.vipSweepTimer) clearInterval(this.vipSweepTimer);
    for (const timer of this.offlineTimers.values()) clearTimeout(timer);
    this.offlineTimers.clear();
  }

  // ── connections ──────────────────────────────────────────────────────────

  /**
   * Socket.io dispatches commands without waiting for this async hook, so the
   * setup is kept as `client.data.ready` (assigned synchronously) and every
   * command awaits it — a `chat:send` right after a reconnect is not a guest's.
   */
  handleConnection(client: ChatSocket): Promise<void> {
    client.data.ready = this.setupConnection(client);
    return client.data.ready;
  }

  private async setupConnection(client: ChatSocket): Promise<void> {
    const playerId = await authenticateSocket(client, this.jwt);
    if (!playerId && extractSocketToken(client)) {
      // A stale token keeps the socket as a guest; the client drops the token on this error.
      client.emit(CHAT_EVENTS.error, { error: 'unauthorized' });
    }
    let viewer: ChatViewer | null = null;
    if (playerId) {
      try {
        viewer = await this.access.resolveViewer(playerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`access of ${playerId} failed: ${message}`);
      }
    }
    // Closed during the awaits: `handleDisconnect` already ran and found nothing to untrack.
    if (!client.connected) return;
    if (viewer) {
      client.data.playerId = viewer.playerId;
      this.trackOnline(viewer.playerId, client.id);
    }
    this.setViewer(client, viewer);
    client.emit(CHAT_EVENTS.access, this.access.snapshot(viewer));
    if (viewer) await this.pushUnread(viewer, client);
  }

  handleDisconnect(client: ChatSocket): void {
    this.unwatchAll(client.id);
    const playerId = client.data.playerId;
    if (!playerId) return;
    const set = this.socketsByPlayer.get(playerId);
    if (!set) return;
    set.delete(client.id);
    if (set.size) return;
    this.socketsByPlayer.delete(playerId);
    // Rate-limit buckets outlive reconnects (or reconnecting would reset the limit); only refilled ones go.
    this.pruneBuckets();
    for (const key of this.lastTyping.keys()) {
      if (key.startsWith(`${playerId}|`)) this.lastTyping.delete(key);
    }
    this.offlineTimers.set(
      playerId,
      setTimeout(() => {
        this.offlineTimers.delete(playerId);
        if (!this.socketsByPlayer.has(playerId)) {
          this.notifyPresence(playerId, false);
        }
      }, CHAT_PRESENCE_GRACE_MS),
    );
  }

  // ── commands ─────────────────────────────────────────────────────────────

  @SubscribeMessage(CHAT_COMMANDS.send)
  onSend(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<ChatAck> {
    return this.run(async () => {
      const viewer = await this.viewerOf(client);
      if (viewer && !this.takeToken(viewer.playerId)) {
        throw new ChatError(
          'rate_limited',
          'Забагато повідомлень — зачекайте секунду',
        );
      }
      const p = asRecord(payload);
      let message: ChatMessageDto;
      try {
        const onlinePlayerIds = this.onlineMentionTargets(
          viewer,
          p.channelKey,
          p.body,
        );
        message = await this.chat.send(viewer, {
          channelKey: p.channelKey,
          body: p.body,
          mentions: p.mentions,
          onlinePlayerIds,
        });
        if (viewer && onlinePlayerIds) {
          this.lastOnlineMention.set(viewer.playerId, Date.now());
        }
      } catch (err) {
        // Only delivered messages count toward the limit; a rejected one (too long, no access) is refunded.
        if (viewer) this.refundToken(viewer.playerId);
        throw err;
      }
      this.server
        .to(this.roomsOf(this.audienceOf(message)))
        .emit(CHAT_EVENTS.message, message);
      // Writing in a channel means having read it.
      if (viewer) void this.markReadAndPush(viewer, message.channelKey);
      return { message };
    });
  }

  @SubscribeMessage(CHAT_COMMANDS.delete)
  onDelete(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<ChatAck> {
    return this.run(async () => {
      const viewer = await this.viewerOf(client);
      const removed = await this.chat.remove(
        viewer,
        asRecord(payload).messageId,
      );
      this.server.to(this.roomsOf(removed)).emit(CHAT_EVENTS.messageDeleted, {
        id: removed.id,
        channelKey: removed.channelKey,
      });
      return { id: removed.id };
    });
  }

  @SubscribeMessage(CHAT_COMMANDS.typing)
  onTyping(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<ChatAck> {
    return this.run(async () => {
      const viewer = await this.viewerOf(client);
      if (!viewer) return {};
      const channel = this.chat.parseChannel(asRecord(payload).channelKey);
      if (isPublicKind(channel.kind)) return {};
      this.chat.assertCanRead(viewer, channel);
      const throttleKey = `${viewer.playerId}|${channel.key}`;
      const now = Date.now();
      if (
        now - (this.lastTyping.get(throttleKey) ?? 0) <
        CHAT_TYPING_THROTTLE_MS
      ) {
        return {};
      }
      this.lastTyping.set(throttleKey, now);
      this.server
        .to(
          this.roomsOf({
            channelKey: channel.key,
            channelKind: channel.kind,
            participantIds: [...channel.participantIds],
          }),
        )
        .except(playerRoom(viewer.playerId))
        .emit(CHAT_EVENTS.typing, {
          channelKey: channel.key,
          playerId: viewer.playerId,
          isAdmin: viewer.isAdmin,
        });
      return {};
    });
  }

  @SubscribeMessage(CHAT_COMMANDS.read)
  onRead(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<ChatAck> {
    return this.run(async () => {
      const viewer = await this.viewerOf(client);
      if (!viewer) throw new ChatError('unauthorized', 'Увійдіть у акаунт');
      const p = asRecord(payload);
      const marker = await this.markReadAndPush(viewer, p.channelKey, p.upTo);
      return { channelKey: marker.channelKey, lastReadAt: marker.lastReadAt };
    });
  }

  /** Replaces the socket's presence watch list; answers with who of them is online now. */
  @SubscribeMessage(CHAT_COMMANDS.watchPresence)
  onWatchPresence(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<ChatAck> {
    return this.run(async () => {
      await client.data.ready?.catch(() => undefined);
      // A socket that already closed must not leave watches behind (its disconnect cleanup ran).
      if (!client.data.playerId || !client.connected) return { online: [] };
      const raw = asRecord(payload).playerIds;
      const ids = [
        ...new Set(
          (Array.isArray(raw) ? raw : [])
            .filter(isUuid)
            .map((id) => id.toLowerCase()),
        ),
      ].slice(0, CHAT_PRESENCE_WATCH_MAX);
      this.unwatchAll(client.id);
      const watched = new Set(ids);
      this.watchedBy.set(client.id, watched);
      for (const id of watched) {
        let watchers = this.watchersOf.get(id);
        if (!watchers) {
          watchers = new Set();
          this.watchersOf.set(id, watchers);
        }
        watchers.add(client.id);
      }
      return { online: ids.filter((id) => this.isOnline(id)) };
    });
  }

  // ── pushes used by other providers ───────────────────────────────────────

  /** Logged-in players with the site open (incl. the short reconnect grace). */
  onlinePlayerIds(): string[] {
    return [
      ...new Set([
        ...this.socketsByPlayer.keys(),
        ...this.offlineTimers.keys(),
      ]),
    ];
  }

  /** After the retention purge: clients drop loaded public messages older than `before`. */
  broadcastPurge(before: Date): void {
    this.server.emit(CHAT_EVENTS.purged, {
      channelKinds: [...CHAT_PUBLIC_KINDS],
      before,
    });
  }

  // ── access ───────────────────────────────────────────────────────────────

  private async viewerOf(client: ChatSocket): Promise<ChatViewer | null> {
    await client.data.ready?.catch(() => undefined);
    const playerId = client.data.playerId;
    if (!playerId) return null;
    const cached = client.data.viewer;
    if (
      cached &&
      Date.now() - (client.data.viewerAt ?? 0) < CHAT_ACCESS_CACHE_MS
    ) {
      return cached;
    }
    const viewer = await this.access.resolveViewer(playerId);
    const before = JSON.stringify(this.access.snapshot(cached ?? null));
    this.setViewer(client, viewer);
    const after = this.access.snapshot(viewer);
    if (JSON.stringify(after) !== before)
      client.emit(CHAT_EVENTS.access, after);
    return viewer;
  }

  /** Caches the viewer on the socket and (re)joins exactly the rooms it may read. */
  private setViewer(client: ChatSocket, viewer: ChatViewer | null): void {
    client.data.viewer = viewer;
    client.data.viewerAt = Date.now();
    const snapshot = this.access.snapshot(viewer);
    const wanted: Record<string, boolean> = {
      [CHAT_ROOMS.general]: true,
      [CHAT_ROOMS.duel]: snapshot.canDuel,
      [CHAT_ROOMS.captains]: snapshot.canCaptains,
      [CHAT_ROOMS.vip]: snapshot.canVip,
      [CHAT_ROOMS.admins]: snapshot.isAdmin,
    };
    if (viewer) wanted[playerRoom(viewer.playerId)] = true;
    for (const [room, join] of Object.entries(wanted)) {
      if (join) void client.join(room);
      else void client.leave(room);
    }
  }

  private async refreshAccess(playerIds: string[]): Promise<void> {
    for (const playerId of new Set(playerIds)) {
      const socketIds = this.socketsByPlayer.get(playerId);
      if (!socketIds?.size) continue;
      try {
        const viewer = await this.access.resolveViewer(playerId);
        const snapshot = this.access.snapshot(viewer);
        for (const id of socketIds) {
          const socket = this.server.sockets.get(id) as ChatSocket | undefined;
          if (!socket) continue;
          this.setViewer(socket, viewer);
          socket.emit(CHAT_EVENTS.access, snapshot);
        }
        if (viewer) await this.pushUnread(viewer);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`access refresh of ${playerId} failed: ${message}`);
      }
    }
  }

  /**
   * Grants, revokes and payments report through `ChatAccessEvents`; a VIP that
   * simply runs out does not, so non-admin members of the VIP room are
   * re-checked here and refreshed (dropped from the room) once expired.
   */
  private async sweepExpiredVip(): Promise<void> {
    const ids = new Set<string>();
    for (const socketId of this.server.adapter.rooms.get(CHAT_ROOMS.vip) ??
      []) {
      const socket = this.server.sockets.get(socketId) as
        | ChatSocket
        | undefined;
      const viewer = socket?.data.viewer;
      if (viewer && !viewer.isAdmin) ids.add(viewer.playerId);
    }
    if (!ids.size) return;
    try {
      await this.refreshAccess(await this.access.expiredVipIds([...ids]));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`VIP expiry sweep failed: ${message}`);
    }
  }

  // ── fan-out ──────────────────────────────────────────────────────────────

  private audienceOf(message: {
    channelKey: string;
    channelKind: ChatChannelKind;
    threadOwner: { id: string } | null;
    participants: { id: string }[] | null;
  }): ChatAudience {
    return {
      channelKey: message.channelKey,
      channelKind: message.channelKind,
      participantIds: message.threadOwner
        ? [message.threadOwner.id]
        : (message.participants ?? []).map((p) => p.id),
    };
  }

  private roomsOf(audience: ChatAudience): string[] {
    switch (audience.channelKind) {
      case ChatChannelKind.GENERAL:
      case ChatChannelKind.CAPTAINS:
      case ChatChannelKind.DUEL:
      case ChatChannelKind.VIP:
        return [CHAT_PUBLIC_ROOM[audience.channelKind]];
      case ChatChannelKind.ADMIN:
        return [...audience.participantIds.map(playerRoom), CHAT_ROOMS.admins];
      case ChatChannelKind.DM:
        return audience.participantIds.map(playerRoom);
    }
  }

  private async markReadAndPush(
    viewer: ChatViewer,
    channelKey: unknown,
    upTo?: unknown,
  ): Promise<{ channelKey: string; lastReadAt: Date }> {
    const marker = await this.chat.markRead(viewer, channelKey, upTo);
    this.server.to(playerRoom(viewer.playerId)).emit(CHAT_EVENTS.read, marker);
    await this.pushUnread(viewer);
    return marker;
  }

  private async pushUnread(
    viewer: ChatViewer,
    only?: ChatSocket,
  ): Promise<void> {
    try {
      const summary = await this.chat.unreadSummary(viewer);
      if (only) only.emit(CHAT_EVENTS.unread, summary);
      else
        this.server
          .to(playerRoom(viewer.playerId))
          .emit(CHAT_EVENTS.unread, summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`unread push to ${viewer.playerId} failed: ${message}`);
    }
  }

  // ── presence ─────────────────────────────────────────────────────────────

  private trackOnline(playerId: string, socketId: string): void {
    const pending = this.offlineTimers.get(playerId);
    if (pending) {
      clearTimeout(pending);
      this.offlineTimers.delete(playerId);
    }
    let set = this.socketsByPlayer.get(playerId);
    const cameOnline = !set && !pending;
    if (!set) {
      set = new Set();
      this.socketsByPlayer.set(playerId, set);
    }
    set.add(socketId);
    if (cameOnline) this.notifyPresence(playerId, true);
  }

  private isOnline(playerId: string): boolean {
    return (
      this.socketsByPlayer.has(playerId) || this.offlineTimers.has(playerId)
    );
  }

  private notifyPresence(playerId: string, online: boolean): void {
    const watchers = this.watchersOf.get(playerId);
    if (!watchers?.size) return;
    this.server
      .to([...watchers])
      .emit(CHAT_EVENTS.presence, { playerId, online });
  }

  private unwatchAll(socketId: string): void {
    const watched = this.watchedBy.get(socketId);
    if (!watched) return;
    for (const id of watched) {
      const watchers = this.watchersOf.get(id);
      watchers?.delete(socketId);
      if (watchers && !watchers.size) this.watchersOf.delete(id);
    }
    this.watchedBy.delete(socketId);
  }

  // ── @online ──────────────────────────────────────────────────────────────

  /**
   * Players `@online` tags: every logged-in socket in the public channel's room
   * (the room already holds exactly who may read it). `undefined` when the
   * message does not use the command; throws while the author's cooldown runs.
   */
  private onlineMentionTargets(
    viewer: ChatViewer | null,
    rawChannel: unknown,
    body: unknown,
  ): string[] | undefined {
    const channel = parseChannelKey(rawChannel);
    if (!viewer || !channel || !isPublicKind(channel.kind)) return undefined;
    if (typeof body !== 'string' || !hasOnlineMention(body)) return undefined;

    const last = this.lastOnlineMention.get(viewer.playerId) ?? 0;
    const waitMs = last + CHAT_ONLINE_MENTION_COOLDOWN_MS - Date.now();
    if (!viewer.isAdmin && waitMs > 0) {
      throw new ChatError(
        'rate_limited',
        `@online можна використати раз на ${CHAT_ONLINE_MENTION_COOLDOWN_MS / 60_000} хв — ще ${Math.ceil(waitMs / 60_000)} хв`,
      );
    }

    const ids = new Set<string>();
    for (const socketId of this.server.adapter.rooms.get(
      CHAT_PUBLIC_ROOM[channel.kind],
    ) ?? []) {
      const socket = this.server.sockets.get(socketId) as
        | ChatSocket
        | undefined;
      const playerId = socket?.data.playerId;
      if (playerId && playerId !== viewer.playerId) ids.add(playerId);
    }
    return [...ids];
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Token bucket: `burst` messages at once, refilled at `refillPerSecond`. */
  private takeToken(playerId: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(playerId) ?? {
      tokens: CHAT_RATE_LIMIT.burst,
      at: now,
    };
    const refilled = Math.min(
      CHAT_RATE_LIMIT.burst,
      bucket.tokens +
        ((now - bucket.at) / 1000) * CHAT_RATE_LIMIT.refillPerSecond,
    );
    if (refilled < 1) {
      this.buckets.set(playerId, { tokens: refilled, at: now });
      return false;
    }
    this.buckets.set(playerId, { tokens: refilled - 1, at: now });
    return true;
  }

  private pruneBuckets(): void {
    const now = Date.now();
    const refillMs =
      (CHAT_RATE_LIMIT.burst / CHAT_RATE_LIMIT.refillPerSecond) * 1000;
    for (const [playerId, bucket] of this.buckets) {
      if (!this.socketsByPlayer.has(playerId) && now - bucket.at >= refillMs) {
        this.buckets.delete(playerId);
      }
    }
    for (const [playerId, at] of this.lastOnlineMention) {
      if (now - at >= CHAT_ONLINE_MENTION_COOLDOWN_MS) {
        this.lastOnlineMention.delete(playerId);
      }
    }
  }

  private refundToken(playerId: string): void {
    const bucket = this.buckets.get(playerId);
    if (!bucket) return;
    bucket.tokens = Math.min(CHAT_RATE_LIMIT.burst, bucket.tokens + 1);
  }

  private async run<T extends object>(
    fn: () => Promise<T>,
  ): Promise<ChatAck<T>> {
    try {
      return { ok: true, ...(await fn()) };
    } catch (err) {
      if (err instanceof ChatError) {
        return { ok: false, error: err.code, message: err.message };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`chat command failed: ${message}`);
      return {
        ok: false,
        error: 'internal',
        message: 'Помилка чату, спробуйте ще раз',
      };
    }
  }
}
