import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  ManyToMany,
  ManyToOne,
  OneToMany,
  JoinColumn,
  JoinTable,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { Match } from '../matches/matches.entity';

@Entity()
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @OneToOne(() => Player, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'captainId' })
  captain: Player;

  @OneToOne(() => Player, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'coachId' })
  coach: Player;

  @Column({ nullable: true, type: 'varchar' })
  logoUrl: string | null;

  @Column()
  isVerified: boolean;

  @Column()
  isPlayingTournament: boolean;

  @Column({ nullable: true })
  verifiedAt: Date;

  @ManyToMany(() => Player)
  @JoinTable({
    name: 'team_main_players',
    joinColumn: { name: 'teamId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'playerId', referencedColumnName: 'id' },
  })
  mainPlayers: Player[];

  @ManyToMany(() => Player)
  @JoinTable({
    name: 'team_reserved_players',
    joinColumn: { name: 'teamId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'playerId', referencedColumnName: 'id' },
  })
  reservedPlayers: Player[];

  @ManyToOne(() => Tournament, (tournament) => tournament.teams, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'tournamentId' })
  tournament: Tournament | null;

  @OneToMany(() => Match, (match) => match.teamA)
  matchesAsTeamA: Match[];

  @OneToMany(() => Match, (match) => match.teamB)
  matchesAsTeamB: Match[];

  @OneToMany(() => Match, (match) => match.winner)
  matchesAsWinner: Match[];
}
