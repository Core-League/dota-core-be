import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Team } from '../teams/team.entity';
import { Playoff } from './playoff.entity';

export type PlayoffFinalType =
  | 'upper_bracket_final'
  | 'lower_bracket_final'
  | 'grand_final';

@Entity('playoff_series')
@Unique('UQ_playoff_series_playoff_challonge', [
  'playoffId',
  'challongeMatchId',
])
export class PlayoffSeries {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  playoffId: string;

  @ManyToOne(() => Playoff, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playoffId' })
  playoff: Playoff;

  /** Challonge bracket node this series resolves (winner advances downstream). */
  @Column({ type: 'varchar' })
  challongeMatchId: string;

  /**
   * Series length: 1 for a regular playoff round; 1, 3 or 5 for a finals slot,
   * per the tournament's finals settings. Every consumer derives wins-to-clinch
   * from this (`winsNeededForBestOf`), never from `isFinalSeries`.
   */
  @Column({ type: 'smallint' })
  bestOf: number;

  /** Finals slot (UBF / LBF / GF), whatever its `bestOf`. */
  @Column({ type: 'boolean', default: false })
  isFinalSeries: boolean;

  @Column({ type: 'varchar', nullable: true })
  finalType: PlayoffFinalType | null;

  @Column({ type: 'uuid', nullable: true })
  teamAId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamAId' })
  teamA: Team | null;

  @Column({ type: 'uuid', nullable: true })
  teamBId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamBId' })
  teamB: Team | null;

  /** Set once a side reaches ⌈bestOf / 2⌉ wins (2 for BO3). */
  @Column({ type: 'uuid', nullable: true })
  seriesWinnerId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'seriesWinnerId' })
  seriesWinner: Team | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
