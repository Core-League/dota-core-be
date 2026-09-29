import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';

/**
 * A player's 1v1 ladder line. Created on the first queue join; the only
 * writer of `rating` / `wins` / `losses` / `streak` is `DuelsService`, in the
 * same transaction that finalises the duel.
 */
@Entity('duel_rating')
export class DuelRating {
  @PrimaryColumn({ type: 'uuid' })
  playerId: string;

  @OneToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  @Column({ type: 'integer', default: 0 })
  rating: number;

  @Column({ type: 'integer', default: 0 })
  wins: number;

  @Column({ type: 'integer', default: 0 })
  losses: number;

  /** Positive = current win streak, negative = current loss streak. */
  @Column({ type: 'integer', default: 0 })
  streak: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastPlayedAt: Date | null;

  /** Queue is refused until this moment (set after a no-show). */
  @Column({ type: 'timestamptz', nullable: true })
  cooldownUntil: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
