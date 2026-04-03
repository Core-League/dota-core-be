import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { UserRoles } from '../user-roles/user-roles.entity';

@Entity()
export class Player {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  steamId: string;

  @Column({ unique: true })
  discordId: string;

  @Column({ unique: true })
  telegramId: string;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column()
  discordName: string;

  @Column()
  discordUsername: string;

  @Column()
  rating: number;

  @Column({ nullable: true })
  verifiedAt: Date;

  @OneToMany(() => UserRoles, (role) => role.player, { cascade: false })
  roles: UserRoles[];
}
