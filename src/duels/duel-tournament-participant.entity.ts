import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { DuelTournament } from './duel-tournament.entity';

/**
 * A player who entered the tournament's password, and their line on its
 * leaderboard. Same columns as `duel_rating`; the only writer of the numbers
 * is `DuelsService`, in the transaction that finalises a tournament duel.
 */
@Entity('duel_tournament_participant')
export class DuelTournamentParticipant {
  @PrimaryColumn({ type: 'uuid' })
  tournamentId: string;

  @ManyToOne(() => DuelTournament, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tournamentId' })
  tournament: DuelTournament;

  @PrimaryColumn({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
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

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;
}
