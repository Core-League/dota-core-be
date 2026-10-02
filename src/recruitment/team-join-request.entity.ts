import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Team } from '../teams/team.entity';
import { Player, type PlayerPosition } from '../players/player.entity';
import {
  JoinRequestKind,
  JoinRequestStatus,
  type TeamMemberSlot,
} from './recruitment.constants';
import { TeamRecruitmentPost } from './team-recruitment-post.entity';

/**
 * A player's application to a team post, or a team's invite to a player.
 * At most one PENDING row per (kind, team, player) — partial unique index
 * `UQ_team_join_request_pending` in the migration.
 */
@Entity('team_join_request')
export class TeamJoinRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: JoinRequestKind;

  @Index('IDX_team_join_request_team')
  @Column({ type: 'uuid' })
  teamId: string;

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teamId' })
  team: Team;

  /** Applicant (APPLICATION) or invitee (INVITE). */
  @Index('IDX_team_join_request_player')
  @Column({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  /** Post an application answers; null for invites. */
  @Column({ type: 'uuid', nullable: true })
  postId: string | null;

  @ManyToOne(() => TeamRecruitmentPost, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'postId' })
  post: TeamRecruitmentPost | null;

  /** Applicant (APPLICATION) or the manager who sent the invite (INVITE). */
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => Player, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdById' })
  createdBy: Player | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  message: string | null;

  /** Position the applicant picked among the post's positions; null for invites. */
  @Column({ type: 'smallint', nullable: true })
  position: PlayerPosition | null;

  /** Invite: slot offered. Application: slot chosen on accept. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  slot: TeamMemberSlot | null;

  @Index('IDX_team_join_request_status')
  @Column({ type: 'varchar', length: 16, default: JoinRequestStatus.PENDING })
  status: JoinRequestStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  respondedById: string | null;
}
