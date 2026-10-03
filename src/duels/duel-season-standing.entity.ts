import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { DuelSeason } from './duel-season.entity';

/**
 * A player's final line on an ended season's table: a snapshot of their
 * `duel_rating` row taken at the rollover (players with at least one game).
 */
@Entity('duel_season_standing')
export class DuelSeasonStanding {
  @PrimaryColumn({ type: 'uuid' })
  seasonId: string;

  @ManyToOne(() => DuelSeason, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'seasonId' })
  season: DuelSeason;

  @Index('IDX_duel_season_standing_player')
  @PrimaryColumn({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  /** Final place, 1-based. */
  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'integer' })
  rating: number;

  @Column({ type: 'integer' })
  wins: number;

  @Column({ type: 'integer' })
  losses: number;

  @Column({ type: 'integer' })
  streak: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastPlayedAt: Date | null;
}
