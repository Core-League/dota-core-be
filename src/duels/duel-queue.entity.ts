import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
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

  /**
   * Rating when the player joined — the matchmaker pairs on this. The ladder
   * rating, or the tournament rating for a tournament queue entry.
   */
  @Column({ type: 'integer', default: 0 })
  rating: number;

  /**
   * Which queue the player waits in: null — the global ladder, otherwise a
   * tournament; the matchmaker pairs only entries of the same queue.
   */
  @Index('IDX_duel_queue_tournament')
  @Column({ type: 'uuid', nullable: true })
  tournamentId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;

  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;
}
