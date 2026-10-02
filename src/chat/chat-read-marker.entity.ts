import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Player } from '../players/player.entity';

/**
 * How far a player has read a channel. Everything newer than `lastReadAt`
 * and not written by the player is unread; a missing row means "never read".
 */
@Entity('chat_read_marker')
export class ChatReadMarker {
  @PrimaryColumn({ type: 'uuid' })
  playerId: string;

  @PrimaryColumn({ type: 'varchar', length: 96 })
  channelKey: string;

  @ManyToOne(() => Player, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playerId' })
  player: Player;

  @Column({ type: 'timestamptz' })
  lastReadAt: Date;
}
