import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';
import {
  DuelBracketMatchResult,
  DuelBracketMatchStatus,
} from './duel.constants';
import { DuelBracket } from './duel-bracket.entity';

/**
 * One node of a single-elimination bracket. Round 1 is filled at launch;
 * every later slot is derived from the two feeding matches of the previous
 * round (winners — or the semi-final losers for the third-place match).
 * While both players are known the match is played as a `duel` of kind
 * `bracket` (`duelId` points at the current one; a replay creates a new one).
 */
@Entity('duel_bracket_match')
@Index('UQ_duel_bracket_match_slot', ['bracketId', 'round', 'position'], {
  unique: true,
})
export class DuelBracketMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_duel_bracket_match_bracket')
  @Column({ type: 'uuid' })
  bracketId: string;

  @ManyToOne(() => DuelBracket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bracketId' })
  bracket: DuelBracket;

  /** 1-based; the final is round `duel_bracket.rounds`. */
  @Column({ type: 'integer' })
  round: number;

  /** 0-based position inside the round; the third-place match is final round, position 1. */
  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'boolean', default: false })
  isThirdPlace: boolean;

  @Column({ type: 'uuid', nullable: true, default: null })
  player1Id: string | null;

  @ManyToOne(() => Player, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'player1Id' })
  player1: Player | null;

  @Column({ type: 'uuid', nullable: true, default: null })
  player2Id: string | null;

  @ManyToOne(() => Player, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'player2Id' })
  player2: Player | null;

  /** Seeds of the two slots (round 1 only) — printed next to the names. */
  @Column({ type: 'integer', nullable: true, default: null })
  seed1: number | null;

  @Column({ type: 'integer', nullable: true, default: null })
  seed2: number | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: DuelBracketMatchStatus.WAITING,
  })
  status: DuelBracketMatchStatus;

  @Column({ type: 'uuid', nullable: true, default: null })
  winnerId: string | null;

  @Column({ type: 'uuid', nullable: true, default: null })
  loserId: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, default: null })
  result: DuelBracketMatchResult | null;

  /** The duel currently (or last) played for this match. */
  @Index('IDX_duel_bracket_match_duel')
  @Column({ type: 'uuid', nullable: true, default: null })
  duelId: string | null;

  /** Duels created for this match so far (replays included). */
  @Column({ type: 'integer', default: 0 })
  duelsCreated: number;

  /** Duels that ended for a technical reason; past the cap the organiser decides. */
  @Column({ type: 'integer', default: 0 })
  techRetries: number;

  /** Why the match waits for the organiser (NEEDS_DECISION), human-readable. */
  @Column({ type: 'varchar', length: 160, nullable: true, default: null })
  note: string | null;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
