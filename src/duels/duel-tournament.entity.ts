import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';
import { DuelTournamentPrize, DuelTournamentStatus } from './duel.constants';

/**
 * A password-protected 1v1 tournament: created by media staff or an admin,
 * joined by players with the password, played through its own queue and
 * ranked on its own table (`duel_tournament_participant`).
 */
@Entity('duel_tournament')
export class DuelTournament {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  /**
   * Join code handed out by the organiser (stream, Discord). Kept in plain
   * text like `duel.lobbyPassword` — it is shown back to the managers only.
   */
  @Column({ type: 'varchar', length: 32 })
  password: string;

  @Index('IDX_duel_tournament_status')
  @Column({ type: 'varchar', length: 16, default: DuelTournamentStatus.ACTIVE })
  status: DuelTournamentStatus;

  /** The organiser; together with admins the only one who may manage it. */
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => Player, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy: Player | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  endedById: string | null;

  /** Prize places, sorted by place; see {@link DuelTournamentPrize}. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  prizes: DuelTournamentPrize[];

  /**
   * When the prizes were settled (winners fixed, VIP granted): after the end,
   * once none of the tournament's games is still running. Null until then.
   */
  @Column({ type: 'timestamptz', nullable: true })
  prizesAwardedAt: Date | null;

  /** Stream link (http/https) the organiser shows on the tournament page. */
  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  streamUrl: string | null;
}
