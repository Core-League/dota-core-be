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

export enum Match3RunStatus {
  /** Started: the seed is issued, the score is not in yet. */
  ACTIVE = 'ACTIVE',
  /** The action log was replayed and the server-computed score stored. */
  FINISHED = 'FINISHED',
}

/**
 * One run of the match-3 mini-game on the duels page. The server issues the
 * seed on start; on finish the client sends its action log and the score is
 * computed by replaying it (`replayMatch3`). A player has at most one ACTIVE
 * run — starting a new one drops the abandoned one. The leaderboard is each
 * player's best FINISHED run.
 */
@Entity('match3_run')
export class Match3Run {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_match3_run_player')
  @Column({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  /** PRNG seed of the board, 0…2^31-1. */
  @Column({ type: 'integer' })
  seed: number;

  @Column({ type: 'varchar', length: 16, default: Match3RunStatus.ACTIVE })
  status: Match3RunStatus;

  @Column({ type: 'integer', default: 0 })
  score: number;

  /** Regular moves made (skills are not counted). */
  @Column({ type: 'integer', default: 0 })
  moves: number;

  /** Longest cascade of the run. */
  @Column({ type: 'integer', default: 0 })
  bestChain: number;

  /** Length of the replayed action log (moves + skills). */
  @Column({ type: 'integer', default: 0 })
  actions: number;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
