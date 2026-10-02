import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { DuelEventsPublisher } from '../duels/duel-events.publisher';
import { Player } from '../players/player.entity';
import {
  NOTIFICATION_SNAPSHOT_LIMIT,
  NotificationStatus,
  NotificationType,
  type NotificationActor,
  type NotificationPayload,
} from './notification.constants';
import { Notification } from './notification.entity';
import {
  NotificationDto,
  NotificationsSnapshotDto,
} from './dto/notification.dto';

export interface CreateNotificationInput {
  playerId: string;
  type: NotificationType;
  /** `friendship.id` / `duel_challenge.id`; the status can be updated by it later. */
  refId?: string | null;
  status?: NotificationStatus | null;
  actor?: Player | NotificationActor | null;
  payload?: Omit<NotificationPayload, 'actor'>;
}

/**
 * Inbox of the header bell. Every write announces the affected players on
 * the duel event bus (`scope: 'notification'`), which the gateway turns into
 * a fresh snapshot push — so a request answered on the friends page also
 * disappears from the bell of the other tab.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly events: DuelEventsPublisher,
  ) {}

  // ── mapping ──────────────────────────────────────────────────────────────

  static actorOf(player: Player | NotificationActor): NotificationActor {
    return {
      id: player.id,
      discordName: player.discordName ?? null,
      discordUsername: player.discordUsername ?? null,
      avatarUrl: player.avatarUrl ?? null,
    };
  }

  private toDto(row: Notification): NotificationDto {
    const payload = row.payload ?? {};
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      refId: row.refId,
      actor: payload.actor ?? null,
      team: payload.team ?? null,
      duelId: payload.duelId ?? null,
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async snapshot(playerId: string): Promise<NotificationsSnapshotDto> {
    const [rows, unreadCount] = await Promise.all([
      this.notifications.find({
        where: { playerId },
        order: { createdAt: 'DESC' },
        take: NOTIFICATION_SNAPSHOT_LIMIT,
      }),
      this.notifications.count({ where: { playerId, readAt: IsNull() } }),
    ]);
    return { items: rows.map((r) => this.toDto(r)), unreadCount };
  }

  // ── writes ───────────────────────────────────────────────────────────────

  async create(input: CreateNotificationInput): Promise<Notification> {
    const row = this.notifications.create({
      playerId: input.playerId,
      type: input.type,
      refId: input.refId ?? null,
      status: input.status ?? null,
      payload: {
        ...(input.payload ?? {}),
        ...(input.actor
          ? { actor: NotificationsService.actorOf(input.actor) }
          : {}),
      },
    });
    const saved = await this.notifications.save(row);
    this.events.notificationsChanged([input.playerId]);
    this.logger.log(
      `notification ${saved.type} → player ${input.playerId} (ref ${input.refId ?? '—'})`,
    );
    return saved;
  }

  /**
   * The request / challenge behind actionable entries was answered (anywhere):
   * mirror the outcome so the bell drops its buttons. Returns the players whose
   * inbox changed (already announced on the bus).
   */
  async resolveByRef(
    refId: string,
    types: NotificationType[],
    status: NotificationStatus,
  ): Promise<string[]> {
    const rows = await this.notifications.find({
      where: { refId, type: In(types) },
      select: { id: true, playerId: true, status: true },
    });
    const toUpdate = rows.filter((r) => r.status !== status);
    if (!toUpdate.length) return [];
    await this.notifications.update(
      { id: In(toUpdate.map((r) => r.id)) },
      { status },
    );
    const playerIds = [...new Set(toUpdate.map((r) => r.playerId))];
    this.events.notificationsChanged(playerIds);
    return playerIds;
  }

  /** `ids` empty / omitted = everything unread of this player. */
  async markRead(
    playerId: string,
    ids?: string[],
  ): Promise<NotificationsSnapshotDto> {
    const result = await this.notifications.update(
      ids?.length
        ? { playerId, id: In(ids), readAt: IsNull() }
        : { playerId, readAt: IsNull() },
      { readAt: new Date() },
    );
    if (result.affected) this.events.notificationsChanged([playerId]);
    return this.snapshot(playerId);
  }
}
