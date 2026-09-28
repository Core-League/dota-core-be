import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { SocialChannel } from './analytics.model';

/**
 * Admin-entered follower count per social channel. Used when the platform has
 * no public API for the number (Instagram, TikTok) or the live fetch is not
 * configured; a live value, when available, always wins over this row.
 */
@Entity()
export class SocialChannelStat {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  channel: SocialChannel;

  @Column({ type: 'int', nullable: true })
  followers: number | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
