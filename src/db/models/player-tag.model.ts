import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { PlayerModel } from './player.model';
import { TagModel } from './tag.model';

/**
 * Player ↔ tag m2m join row (`player_tag`). `playerId` references a v1-owned
 * `player` row, exposed as the read-only `player` relation; `tagId` cascades
 * with the tag catalog.
 */
@Entity({ name: 'player_tag' })
@Unique(['playerId', 'tagId'])
export class PlayerTagModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  playerId: string;

  @ManyToOne(() => PlayerModel)
  @JoinColumn({
    name: 'playerId',
    foreignKeyConstraintName: 'FK_player_tag_player',
  })
  player: PlayerModel;

  @Column({ type: 'uuid' })
  tagId: string;

  @ManyToOne(() => TagModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tagId' })
  tag: TagModel;
}
