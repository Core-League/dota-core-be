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
import { DuelChallengeStatus } from './duel.constants';

/**
 * "Play me a friendly duel" — an invitation from one friend to another.
 * Accepting it creates a `duel` of kind `friend` (±10) right away; the
 * invitation expires on its own after `DUEL_CHALLENGE_TTL_SECONDS`.
 */
@Entity('duel_challenge')
export class DuelChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_duel_challenge_challenger')
  @Column({ type: 'uuid' })
  challengerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challengerId' })
  challenger: Player;

  @Index('IDX_duel_challenge_challenged')
  @Column({ type: 'uuid' })
  challengedId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challengedId' })
  challenged: Player;

  @Index('IDX_duel_challenge_status')
  @Column({ type: 'varchar', length: 16, default: DuelChallengeStatus.PENDING })
  status: DuelChallengeStatus;

  /** The friendly duel this challenge created once it was accepted. */
  @Column({ type: 'uuid', nullable: true })
  duelId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** A PENDING challenge nobody answered by this moment becomes EXPIRED. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;
}
