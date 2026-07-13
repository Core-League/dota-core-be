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

  @Column({ type: 'enum', enum: TournamentDivision, nullable: true })
  division: TournamentDivision | null;

  @Column({ nullable: true })
  headerBannerUrl: string;

  @Column({ nullable: true })
  listBannerUrl: string;

  @Column({ nullable: true })
  tournamentSlots: number;

  @Column()
  registrationStartsAt: Date;

  @Column()
  registrationEndsAt: Date;

  @Column()
  tournamentStartsAt: Date;

  @Column()
  tournamentEndsAt: Date;

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
