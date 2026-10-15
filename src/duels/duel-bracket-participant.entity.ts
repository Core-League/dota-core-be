import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { DuelBracket } from './duel-bracket.entity';

/** A player registered for a bracket, with their seed and final place. */
@Entity('duel_bracket_participant')
export class DuelBracketParticipant {
  @PrimaryColumn({ type: 'uuid' })
  bracketId: string;

  @ManyToOne(() => DuelBracket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bracketId' })
  bracket: DuelBracket;

  @Index('IDX_duel_bracket_participant_player')
  @PrimaryColumn({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  /** 1 = top seed; set at launch. */
  @Column({ type: 'integer', nullable: true, default: null })
  seed: number | null;

  /**
   * Best place the player can still finish on — fixed when they are knocked
   * out (e.g. 5 for a quarter-final loser: places 5–8), 1 for the champion.
   */
  @Column({ type: 'integer', nullable: true, default: null })
  place: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;
}
