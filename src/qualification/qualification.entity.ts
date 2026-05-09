import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Tournament } from '../tournaments/tournaments.entity';
import { QualificationMatch } from './qualification-match.entity';

@Entity('qualification')
export class Qualification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Tournament, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tournamentId' })
  tournament: Tournament;

  @Column({ type: 'timestamptz' })
  startTime: Date;

  @Column({ type: 'timestamptz' })
  endTime: Date;

  @Column({ type: 'varchar' })
  nodeGroupId: string;

  @OneToMany(() => QualificationMatch, (m) => m.qualification)
  matches: QualificationMatch[];
}
