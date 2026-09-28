import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { Team } from '../teams/team.entity';

export type MatchStage = 'qualification' | 'playoff';

/**
 * Who actually played a recorded map, taken from the Dota match data
 * (OpenDota / Stratz) when a result is submitted or backfilled. This is the
 * source of truth for per-player match statistics; rosters only say who was
 * allowed to play.
 */
@Entity('match_participant')
@Unique('UQ_match_participant_stage_match_player', [
  'stage',
  'matchId',
  'playerId',
])
export class MatchParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  stage: MatchStage;

  /**
   * `qualification_match.id` or `playoff_match.id` depending on `stage`. No FK:
   * the two tables are distinct and a playoff can be regenerated; readers join
   * back to the live match row and ignore orphans.
   */
  @Column({ type: 'uuid' })
  matchId: string;

  @Column({ type: 'uuid' })
  tournamentId: string;

  @Column({ type: 'varchar' })
  dotaMatchId: string;

  @Index('IDX_match_participant_player')
  @Column({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  /** Side the player was on, as a Core team; null once that team row is gone. */
  @Column({ type: 'uuid', nullable: true })
  teamId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamId' })
  team: Team | null;

  @Column({ type: 'boolean' })
  isRadiant: boolean;

  /** Outcome at record time; readers prefer the live match winner when the team is known. */
  @Column({ type: 'boolean' })
  won: boolean;

  @Column({ type: 'integer', nullable: true })
  heroId: number | null;

  @Column({ type: 'smallint', nullable: true })
  kills: number | null;

  @Column({ type: 'smallint', nullable: true })
  deaths: number | null;

  @Column({ type: 'smallint', nullable: true })
  assists: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
