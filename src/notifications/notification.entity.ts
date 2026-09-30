import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';
import type {
  NotificationPayload,
  NotificationStatus,
  NotificationType,
} from './notification.constants';

/**
 * One inbox entry of a player (the header bell). Actionable entries (a friend
 * request, a duel challenge) carry the id of the thing to act on in `refId`
 * and mirror its outcome in `status`, so the bell can hide the buttons once
 * the request was answered anywhere else.
 */
@Entity('notification')
@Index('IDX_notification_player_created', ['playerId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  @Column({ type: 'varchar', length: 32 })
  type: NotificationType;

  /** Outcome of the underlying request / challenge; null for informational entries. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  status: NotificationStatus | null;

  /** `friendship.id` or `duel_challenge.id` the entry is about. */
  @Index('IDX_notification_ref')
  @Column({ type: 'uuid', nullable: true })
  refId: string | null;

  @Column({ type: 'jsonb', default: {} })
  payload: NotificationPayload;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
