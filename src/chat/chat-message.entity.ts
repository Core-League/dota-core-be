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
import type { ChatChannelKind } from './chat.constants';

/**
 * One chat message. `channelKey` identifies the channel (`general`,
 * `captains`, `duel`, `admin:<ownerId>`, `dm:<minId>:<maxId>`);
 * `participantIds` lists who a private channel belongs to (the thread owner
 * for `admin`, both players for `dm`, empty for public channels) so a
 * player's private threads are one GIN-indexed lookup.
 */
@Entity('chat_message')
@Index('IDX_chat_message_channel_created', ['channelKey', 'createdAt'])
@Index('IDX_chat_message_kind_created', ['channelKind', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 96 })
  channelKey: string;

  @Column({ type: 'varchar', length: 16 })
  channelKind: ChatChannelKind;

  @Column({ type: 'uuid' })
  authorId: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorId' })
  author: Player;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  participantIds: string[];

  /** Players mentioned with `@nick` (validated against the body and channel access). */
  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  mentionedPlayerIds: string[];

  /** Millisecond precision: clients send it back as the read marker / history cursor. */
  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt: Date;

  /** Removed by an admin; hidden from history, kept until the retention job. */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deletedById: string | null;
}
