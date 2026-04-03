import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { TournamentStatus } from './tournaments.model';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';

@Entity()
export class Tournament {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  prizePool: number;

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

  @OneToMany(() => Team, (team) => team.tournament)
  teams: Team[];

  @ManyToMany(() => UserRoles, { cascade: false })
  @JoinTable({
    name: 'tournament_allowed_roles',
    joinColumn: { name: 'tournamentId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' },
  })
  eligibleRoles: UserRoles[];
}
