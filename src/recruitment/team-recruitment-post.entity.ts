import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Team } from '../teams/team.entity';
import {
  Player,
  type PlayerPosition,
  TournamentFormat,
} from '../players/player.entity';
import { TeamPostStatus } from './recruitment.constants';

/**
 * "Team is looking for players": at most one OPEN post per team (partial
 * unique index `UQ_team_recruitment_post_open` in the migration). Closes by
 * hand or once `playersNeeded` drops to 0.
 */
@Entity('team_recruitment_post')
export class TeamRecruitmentPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_team_recruitment_post_team')
  @Column({ type: 'uuid' })
  teamId: string;

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teamId' })
  team: Team;

  /** Captain / coach / admin who created the post. */
  @Column({ type: 'uuid', nullable: true })
  authorId: string | null;

  @ManyToOne(() => Player, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'authorId' })
  author: Player | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string | null;

  @Column({ type: 'smallint', array: true })
  positions: PlayerPosition[];

  @Column({ type: 'smallint' })
  playersNeeded: number;

  @Column({ type: 'integer', nullable: true })
  mmrMin: number | null;

  @Column({ type: 'integer', nullable: true })
  mmrMax: number | null;

  /** Formats the team plays; empty = any. */
  @Column({ type: 'varchar', array: true, default: () => "'{}'" })
  formats: TournamentFormat[];

  @Index('IDX_team_recruitment_post_status')
  @Column({ type: 'varchar', length: 16, default: TeamPostStatus.OPEN })
  status: TeamPostStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
