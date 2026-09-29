import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { HostBotStatus } from './duel.constants';

/**
 * A Steam account the bot-worker logs into to host lobbies. Passwords are
 * stored AES-256-GCM encrypted with `HOSTBOT_SECRET_KEY`; the admin API
 * writes rows, the worker reads them. Steam Guard must be disabled on the
 * account (the worker has no 2FA flow).
 */
@Entity('host_bot')
export class HostBot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  accountName: string;

  @Column({ type: 'text' })
  passwordEnc: string;

  /** Known after the first successful login. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  steamId64: string | null;

  @Column({ type: 'integer', default: 3 })
  region: number;

  @Column({ type: 'varchar', length: 16, default: HostBotStatus.OFFLINE })
  status: HostBotStatus;

  @Column({ type: 'uuid', nullable: true })
  currentDuelId: string | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  /** Written by the worker every few seconds; lets the admin panel spot a dead worker. */
  @Column({ type: 'timestamptz', nullable: true })
  lastHeartbeatAt: Date | null;

  /** Admin switch: disabled bots are logged off and never claim duels. */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** Admin asked for a restart; the worker restarts the bot when this is newer than its start. */
  @Column({ type: 'timestamptz', nullable: true })
  reloadRequestedAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
