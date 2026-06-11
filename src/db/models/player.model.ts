import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Dota map / role position (1–5). Mirrors v1's `Player.positions`. */
export type PlayerPosition = 1 | 2 | 3 | 4 | 5;

/**
 * Read-only v2 mapping of the **v1-owned** `player` table. v2 does not own this
 * schema: `synchronize: false` keeps it out of v2's schema sync / migration
 * diffs, so v2 never alters the table. It exists only to back relations (see
 * {@link VerificationRequestPlayerModel}); writes still go through raw SQL in
 * `PlayerRepository`. Only the columns v2 reads are mapped.
 */
@Entity({ name: 'player', synchronize: false })
export class PlayerModel {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  steamId: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  discordName: string | null;

  @Column({ type: 'varchar', nullable: true })
  discordUsername: string | null;

  @Column({ type: 'real', default: 0 })
  rating: number;

  @Column({ type: 'smallint', array: true, nullable: true })
  positions: PlayerPosition[] | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;
}
