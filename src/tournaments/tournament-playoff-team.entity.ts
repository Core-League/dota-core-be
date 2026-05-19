import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Tournament } from './tournaments.entity';
import { Team } from '../teams/team.entity';

@Entity('tournament_playoff_team')
@Unique(['tournamentId', 'teamId'])
export class TournamentPlayoffTeam {
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

  @Column({ type: 'varchar', nullable: true })
  challongeParticipantId: string | null;

  @Column({ default: false })
  isDisqualified: boolean;
}
