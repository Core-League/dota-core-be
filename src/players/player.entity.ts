import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { UserRoles } from '../user-roles/user-roles.entity';

/** Dota map / role position (1–5). */
export type PlayerPosition = 1 | 2 | 3 | 4 | 5;

/** Tournament formats a player is willing to attend. */
export enum TournamentFormat {
  ONLINE = 'ONLINE',
  LAN = 'LAN',
}

export const TOURNAMENT_FORMATS: TournamentFormat[] = [
  TournamentFormat.ONLINE,
  TournamentFormat.LAN,
];

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

  /** ISO 3166-1 alpha-2 country code (upper-case); null when unset. */
  @Column({ type: 'varchar', length: 2, nullable: true })
  countryCode: string | null;

  /** City name as returned by the locations catalog; null when unset. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  /** Tournament formats the player wants to attend; null when unset, empty when explicitly none. */
  @Column({ type: 'varchar', array: true, nullable: true })
  wantToPlay: TournamentFormat[] | null;

  /**
   * Ukrainian cities the player can travel to for LAN tournaments (names from
   * the bundled UA catalog). Only meaningful with `wantToPlay` ∋ LAN; null when unset.
   */
  @Column({ type: 'varchar', array: true, nullable: true })
  lanCities: string[] | null;

  @Column({ nullable: true, type: 'timestamptz' })
  verifiedAt: Date | null;

  /** VIP lasts while this lies in the future (paid through Monobank or granted by an admin). */
  @Column({ type: 'timestamptz', nullable: true })
  vipUntil: Date | null;

  /** Card frame colour from `VIP_FRAME_COLORS`; shown only while VIP lasts. */
  @Column({ type: 'varchar', length: 7, nullable: true })
  vipFrameColor: string | null;

  /**
   * Team reference: internal team UUID and/or public Dotabuff/OpenDota team id string,
   * depending on deployment. Column is varchar so DB operators match string parameters.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  teamId: string | null;

  @OneToMany(() => UserRoles, (role) => role.player, { cascade: false })
  roles: UserRoles[];
}
