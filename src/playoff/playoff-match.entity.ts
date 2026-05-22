import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Team } from '../teams/team.entity';
import { Playoff } from './playoff.entity';

@Entity('playoff_match')
export class PlayoffMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  playoffId: string;

  @ManyToOne(() => Playoff, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playoffId' })
  playoff: Playoff;

  @Column({ type: 'uuid', nullable: true })
  teamAId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamAId' })
  teamA: Team | null;

  @Column({ type: 'uuid', nullable: true })
  teamBId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamBId' })
  teamB: Team | null;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'winnerId' })
  winner: Team | null;

  @Column({ type: 'varchar', nullable: true })
  dotaMatchId: string | null;

  @Column({ type: 'varchar' })
  challongeMatchId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
