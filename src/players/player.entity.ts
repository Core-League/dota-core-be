import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { UserRoles } from '../user-roles/user-roles.entity';

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

  @Column({ nullable: true })
  verifiedAt: Date;

  @OneToMany(() => UserRoles, (role) => role.player, { cascade: false })
  roles: UserRoles[];
}
