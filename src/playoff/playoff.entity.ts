import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tournament } from '../tournaments/tournaments.entity';

@Entity('playoff')
export class Playoff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tournamentId: string;

  @OneToOne(() => Tournament, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tournamentId' })
  tournament: Tournament;

  @Column({ type: 'varchar' })
  challongeTournamentId: string;

  @Column({ type: 'varchar' })
  challongeUrl: string;

  @Column({ type: 'varchar' })
  challongeEmbedUrl: string;
}
