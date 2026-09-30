import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { FriendshipStatus } from './friends.constants';

/**
 * One row per unordered pair of players: a PENDING friend request (from
 * `requester` to `addressee`) or an ACCEPTED friendship. Declined requests
 * and removed friends are deleted, so the pair can start over later.
 * The unique expression index on (LEAST, GREATEST) lives in the migration.
 */
@Entity('friendship')
export class Friendship {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_friendship_requester')
  @Column({ type: 'uuid' })
  requesterId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requesterId' })
  requester: Player;

  @Index('IDX_friendship_addressee')
  @Column({ type: 'uuid' })
  addresseeId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'addresseeId' })
  addressee: Player;

  @Column({ type: 'varchar', length: 16, default: FriendshipStatus.PENDING })
  status: FriendshipStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** When the addressee accepted; null while PENDING. */
  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;
}
