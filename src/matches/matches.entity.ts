import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Team } from '../teams/team.entity';

@Entity()
export class Match {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Team, (team: Team) => team.matchesAsTeamA, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'teamAId' })
  teamA: Team;

  @ManyToOne(() => Team, (team: Team) => team.matchesAsTeamB, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'teamBId' })
  teamB: Team;

  @ManyToOne(() => Team, (team: Team) => team.matchesAsWinner, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'winnerId' })
  winner: Team;

  @Column()
  dotaMatchId: string;
}
