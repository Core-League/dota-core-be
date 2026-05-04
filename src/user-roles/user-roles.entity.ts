import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  ManyToMany,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { Tournament } from '../tournaments/tournaments.entity';

@Entity()
export class UserRoles {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  isAdminRole: boolean;

  /** Null for system role catalog rows (Гість / Гравець / Капітан / Медіа / Адмін). */
  @ManyToOne(() => Player, (player) => player.roles, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'playerId' })
  player: Player | null;

  @ManyToMany(() => Tournament, (tournament) => tournament.eligibleRoles)
  tournaments: Tournament[];
}
