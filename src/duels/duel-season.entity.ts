import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DuelSeasonPrize, DuelSeasonStatus } from './duel.constants';

/**
 * A monthly season of the 1v1 ladder (a Kyiv calendar month). Ranked and
 * friendly duels count for the ACTIVE one (`duel.seasonId`). At its end the
 * ladder (`duel_rating`) is frozen into `duel_season_standing` and reset, the
 * next season opens and the prize places are settled.
 */
@Entity('duel_season')
@Index('UQ_duel_season_active', ['status'], {
  unique: true,
  where: `"status" = 'ACTIVE'`,
})
export class DuelSeason {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 1, 2, 3, … — shown as «Сезон N». */
  @Index('UQ_duel_season_number', { unique: true })
  @Column({ type: 'integer' })
  number: number;

  @Column({ type: 'timestamptz' })
  startsAt: Date;

  /** Exclusive end: the first moment of the next season. */
  @Column({ type: 'timestamptz' })
  endsAt: Date;

  /** One ACTIVE row at most (partial unique index in the migration). */
  @Column({ type: 'varchar', length: 16, default: DuelSeasonStatus.ACTIVE })
  status: DuelSeasonStatus;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  /** Prize places set by admins, sorted by place; see {@link DuelSeasonPrize}. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  prizes: DuelSeasonPrize[];

  /** When the winners were fixed and VIP granted; null until then. */
  @Column({ type: 'timestamptz', nullable: true })
  prizesAwardedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
