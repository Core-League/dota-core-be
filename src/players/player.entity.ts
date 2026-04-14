import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { UserRoles } from '../user-roles/user-roles.entity';

@Entity()
export class Player {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Linked later; null for Discord-only accounts until Steam is connected. */
  @Column({ unique: true, nullable: true })
  steamId: string | null;

  @Column({ unique: true })
  discordId: string;

  /** Linked later; null for Discord-only accounts until Telegram is connected. */
  @Column({ unique: true, nullable: true })
  telegramId: string | null;

  @Column({ nullable: true })
  avatarUrl: string | null;

  @Column()
  discordName: string;

  @Column()
  discordUsername: string;

  @Column({ type: 'real', default: 0 })
  rating: number;

  @Column({ nullable: true })
  verifiedAt: Date;

  @OneToMany(() => UserRoles, (role) => role.player, { cascade: false })
  roles: UserRoles[];
}
