import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { TagModel } from './tag.model';

/**
 * Player ↔ tag m2m join row (`player_tag`). `playerId` references a v1-owned
 * `player` row, so it carries no FK; `tagId` cascades with the tag catalog.
 */
@Entity({ name: 'player_tag' })
@Unique(['playerId', 'tagId'])
export class PlayerTagModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  playerId: string;

  @Column({ type: 'uuid' })
  tagId: string;

  @ManyToOne(() => TagModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tagId' })
  tag: TagModel;
}
