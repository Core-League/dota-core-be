import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  ManyToOne,
  ManyToMany,
  OneToMany,
  JoinColumn,
  JoinTable,
  Index,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { Match } from '../matches/matches.entity';

@Entity()
@Index('UQ_team_active_captain', ['captain'], {
  unique: true,
  where: '"disbandedAt" IS NULL',
})
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => Player, {
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
  coach: Player | null;

  @Column({ nullable: true, type: 'varchar' })
  logoUrl: string | null;

  @Column({ nullable: true, type: 'varchar' })
  dotaTeamId: string | null;

  @Column({ nullable: true, type: 'varchar' })
  discordRoleId: string | null;

  @Column({ nullable: true, type: 'varchar' })
  discordChannelId: string | null;

  @Column()
  isVerified: boolean;

  @Column()
  isPlayingTournament: boolean;

  @Column({ nullable: true, type: 'timestamptz' })
  verifiedAt: Date | null;

  // Re-verification cooldown: set when an admin cancels a team's in-progress
  // verification. While in the future, the team cannot book a new verification.
  @Column({ nullable: true, type: 'timestamptz' })
  verificationBlockedUntil: Date | null;

  @Column({ nullable: true, type: 'timestamptz' })
  disbandedAt: Date | null;

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

  @ManyToMany(() => Tournament, (tournament) => tournament.teams)
  tournaments: Tournament[];

  @OneToMany(() => Match, (match) => match.teamA)
  matchesAsTeamA: Match[];

  @OneToMany(() => Match, (match) => match.teamB)
  matchesAsTeamB: Match[];

  @OneToMany(() => Match, (match) => match.winner)
  matchesAsWinner: Match[];
}
