import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tournament } from './tournaments.entity';
import { Team } from '../teams/team.entity';
import { PaymentStatus } from './tournament-team-payment.model';

/**
 * A team's entry-fee payment for a tournament. Exists before the team joins
 * (payment gates the join), so it is a standalone entity rather than a column
 * on the bare `tournament_team` join table.
 */
@Entity('tournament_team_payment')
@Unique('UQ_tournament_team_payment_tournament_team', [
  'tournamentId',
  'teamId',
])
export class TournamentTeamPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tournamentId: string;

  @ManyToOne(() => Tournament, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tournamentId' })
  tournament: Tournament;

  @Column({ type: 'uuid' })
  teamId: string;

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'teamId' })
  team: Team;

  /** Unique code (e.g. CORE-7F3K9Q) prefilled into the Monobank jar comment. */
  @Column({ type: 'varchar', unique: true })
  reference: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  /** Amount paid so far, in kopecks. */
  @Column({ type: 'int', default: 0 })
  amountPaid: number;

  /** Id of the matched bank transaction, once reconciled. */
  @Column({ type: 'varchar', nullable: true })
  transactionId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  /** Set when an admin manually marked the payment as paid. */
  @Column({ type: 'uuid', nullable: true })
  markedByAdminId: string | null;

  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
