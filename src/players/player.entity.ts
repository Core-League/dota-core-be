import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { UserRoles } from '../user-roles/user-roles.entity';

/** Dota map / role position (1–5). */
export type PlayerPosition = 1 | 2 | 3 | 4 | 5;

@Entity()
export class Player {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true, nullable: true })
  steamId: string | null;

  /** null for Steam-only accounts until Discord is connected */
  @Column({ type: 'varchar', unique: true, nullable: true })
  discordId: string | null;

  /** Linked later; null for Discord-only accounts until Telegram is connected. */
  @Column({ type: 'varchar', unique: true, nullable: true })
  telegramId: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  discordName: string | null;

  @Column({ type: 'varchar', nullable: true })
  discordUsername: string | null;

  @Column({ type: 'real', default: 0 })
  rating: number;

  /** Lane / roles (1–5); null when unset, empty array when explicitly none. */
  @Column({ type: 'smallint', array: true, nullable: true })
  positions: PlayerPosition[] | null;

  @Column({ nullable: true, type: 'timestamptz' })
  verifiedAt: Date | null;

  /**
   * Team reference: internal team UUID and/or public Dotabuff/OpenDota team id string,
   * depending on deployment. Column is varchar so DB operators match string parameters.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  teamId: string | null;

  @OneToMany(() => UserRoles, (role) => role.player, { cascade: false })
  roles: UserRoles[];
}
