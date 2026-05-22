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
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'teamAId' })
  teamA: Team | null;

  @ManyToOne(() => Team, (team: Team) => team.matchesAsTeamB, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'teamBId' })
  teamB: Team | null;

  @ManyToOne(() => Team, (team: Team) => team.matchesAsWinner, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'winnerId' })
  winner: Team | null;

  @Column()
  dotaMatchId: string;
}
