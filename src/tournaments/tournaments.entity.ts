import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { TournamentDivision, TournamentStatus } from './tournaments.model';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';

@Entity()
export class Tournament {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true, type: 'int' })
  prizePool: number | null;

  /** Tournament entry fee in kopecks. null or 0 means the tournament is free (no payment gate). */
  @Column({ nullable: true, type: 'int' })
  entryFee: number | null;

  /**
   * Public Monobank jar link captains are redirected to for the entry fee.
   * Set per-tournament by an admin; falls back to MONOBANK_JAR_URL when empty.
   */
  @Column({ nullable: true, type: 'varchar' })
  paymentJarUrl: string | null;

  @Column({ type: 'enum', enum: TournamentDivision, nullable: true })
  division: TournamentDivision | null;

  @Column({ nullable: true })
  headerBannerUrl: string;

  @Column({ nullable: true })
  listBannerUrl: string;

  @Column({ nullable: true })
  tournamentSlots: number;

  /**
   * Tournament schedule — three independent windows, each authored by an admin:
   *
   * 1. Registration (`registrationStartsAt`/`registrationEndsAt`) — when a captain may
   *    join the tournament and start an entry-fee payment. See `tournament-registration.util.ts`.
   * 2. Qualification (`qualificationStartsAt`/`qualificationEndsAt`) — the qualification
   *    match-submission window, mirrored onto `Qualification.startTime`/`endTime`.
   *    Both are null when `hasQualification` is false; `getScheduleViolation` skips
   *    every rule whose dates are absent, so the window simply drops out.
   * 3. Playoff (`tournamentStartsAt`/`tournamentEndsAt`) — bracket start (the auto-start
   *    scheduler trigger) and tournament end. Kept under the historical `tournament*`
   *    names because they are part of the public team/tournament response contract.
   *
   * Ordering is enforced by `validateTournamentSchedule`: start < end within each window,
   * and qualification must finish before the playoff starts. Registration is deliberately
   * allowed to overlap qualification — a team may join during either phase.
   */
  @Column()
  registrationStartsAt: Date;

  @Column()
  registrationEndsAt: Date;

  /**
   * Set when an admin closes registration ahead of `registrationEndsAt`; null means
   * "not manually closed". Separate from `registrationEndsAt` so an early close is
   * reported as an admin action rather than a schedule change.
   */
  @Column({ nullable: true, type: 'timestamp' })
  registrationClosedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  qualificationStartsAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  qualificationEndsAt: Date | null;

  /**
   * Whether the tournament runs a qualification stage at all. Set at creation and
   * never changed afterwards, so a tournament cannot lose qualification data it
   * already holds.
   *
   * When false there is no `Qualification` row, no qualification dates, no
   * qualification tab on the frontend, and the lifecycle is REGISTRATION →
   * PLAYOFF: `TournamentQualificationScheduler` skips the tournament and
   * `TournamentPlayoffScheduler` starts the bracket at `tournamentStartsAt`.
   * See `validateQualificationConfig` for the rules this implies.
   */
  @Column({ type: 'boolean', default: true })
  hasQualification: boolean;

  /** Playoff bracket start. `TournamentPlayoffScheduler` auto-starts the bracket at this moment. */
  @Column()
  tournamentStartsAt: Date;

  /** Playoff / tournament end. Also bounds the per-team overlapping-tournament check. */
  @Column()
  tournamentEndsAt: Date;

  /**
   * Lifecycle: REGISTRATION → QUALIFICATIONS → PLAYOFF → COMPLETED.
   *
   * A team may join (and pay an entry fee) in REGISTRATION **or** QUALIFICATIONS —
   * see `isJoinableStatus`; whether registration is actually open is decided by the
   * dates. `TournamentQualificationScheduler` advances the status at
   * `qualificationStartsAt` and `TournamentPlayoffScheduler` at `tournamentStartsAt`.
   * COMPLETED is never set on creation — see `CreateTournamentDto`.
   */
  @Column({ type: 'enum', enum: TournamentStatus })
  tournamentStatus: TournamentStatus;

  @Column({ nullable: true })
  tournamentGridUrl: string;

  @ManyToMany(() => Team, (team) => team.tournaments)
  @JoinTable({
    name: 'tournament_team',
    joinColumn: { name: 'tournamentId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'teamId', referencedColumnName: 'id' },
  })
  teams: Team[];

  @ManyToMany(() => UserRoles, { cascade: false })
  @JoinTable({
    name: 'tournament_allowed_roles',
    joinColumn: { name: 'tournamentId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' },
  })
  eligibleRoles: UserRoles[];
}
