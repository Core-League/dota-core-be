import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';

/**
 * "Player is looking for a team": one listing per player. Only the
 * description is stored — MMR, positions, formats and city come live from
 * the profile. Deleted when the player joins a team or removes it.
 */
@Entity('player_recruitment_post')
export class PlayerRecruitmentPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('UQ_player_recruitment_post_player', { unique: true })
  @Column({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  @Column({ type: 'varchar', length: 200, nullable: true })
  description: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
