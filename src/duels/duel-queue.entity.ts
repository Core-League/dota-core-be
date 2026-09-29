import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';

/**
 * Who is waiting for a 1v1 opponent. The primary key on `playerId` is what
 * enforces "one queue entry per player". `lastSeenAt` is refreshed by every
 * `GET /duels/me`; the matchmaker drops rows that stopped polling.
 */
@Entity('duel_queue')
export class DuelQueueEntry {
  @PrimaryColumn({ type: 'uuid' })
  playerId: string;

  @OneToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  /** 1v1 rating when the player joined — the matchmaker pairs on this. */
  @Column({ type: 'integer', default: 0 })
  rating: number;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;
}
