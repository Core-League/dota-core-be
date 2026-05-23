import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Team } from '../teams/team.entity';
import { Qualification } from './qualification.entity';

@Entity('qualification_match')
export class QualificationMatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Qualification, (q) => q.matches, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'qualificationId' })
  qualification: Qualification;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamAId' })
  teamA: Team | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamBId' })
  teamB: Team | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'winnerId' })
  winner: Team | null;

  @Column({ nullable: true, type: 'varchar' })
  dotaMatchId: string | null;

  @Column({ type: 'varchar' })
  nodeGroupId: string;
}
