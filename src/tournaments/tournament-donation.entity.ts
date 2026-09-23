import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tournament } from './tournaments.entity';
import { PaymentStatus } from './tournament-team-payment.model';

/**
 * A voluntary donation towards a tournament, paid through the same Monobank
 * acquiring rail as entry fees. Unlike `tournament_team_payment` there is no
 * natural key: every intent is its own row and its own invoice, so two clicks
 * are two donations. Anyone may donate — `donorPlayerId` is only filled when a
 * valid bearer token happened to accompany the request.
 */
@Entity('tournament_donation')
@Index('IDX_tournament_donation_tournament', ['tournamentId'])
@Unique('UQ_tournament_donation_reference', ['reference'])
@Unique('UQ_tournament_donation_invoice', ['invoiceId'])
export class TournamentDonation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tournamentId: string;

  @ManyToOne(() => Tournament, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tournamentId' })
  tournament: Tournament;

  /**
   * Unique code (e.g. DON-7F3K9Q) sent as the invoice's
   * merchantPaymInfo.reference. The `DON-` prefix keeps a donation callback
   * from ever being mistaken for a `CORE-` entry fee.
   */
  @Column({ type: 'varchar' })
  reference: string;

  /** Amount the donor asked to give, in kopecks. */
  @Column({ type: 'int' })
  amount: number;

  /** Amount actually settled by Monobank, in kopecks. */
  @Column({ type: 'int', default: 0 })
  amountPaid: number;

  /** Reuses the entry-fee enum; UNDERPAID is never produced for donations. */
  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  /** Open Monobank invoice and its hosted page; both cleared once the invoice dies or is paid. */
  @Column({ type: 'varchar', nullable: true })
  invoiceId: string | null;

  @Column({ type: 'varchar', nullable: true })
  paymentPageUrl: string | null;

  /** Player id from the JWT when the donor was logged in; null for guests. */
  @Column({ type: 'uuid', nullable: true })
  donorPlayerId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
