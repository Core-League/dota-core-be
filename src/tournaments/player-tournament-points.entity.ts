import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { Tournament } from './tournaments.entity';

@Entity('player_tournament_points')
@Unique(['playerId', 'tournamentId'])
export class PlayerTournamentPoints {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  @Column({ type: 'uuid' })
  tournamentId: string;

  @ManyToOne(() => Tournament, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tournamentId' })
  tournament: Tournament;

  @Column({ type: 'int', default: 0 })
  points: number;
}
