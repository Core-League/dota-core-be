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
import {
  DuelBracketSeeding,
  DuelBracketStatus,
  DuelBracketStreamerLinks,
  DuelTournamentPrize,
} from './duel.constants';

/**
 * A single-elimination 1v1 tournament run by a streamer (media staff) or an
 * admin: players register, the organiser launches it, and every match of the
 * bracket is played as a bot-hosted duel of kind `bracket`
 * (`duel_bracket_match` → `duel`). Shown under «Медіа-турніри».
 */
@Entity('duel_bracket')
export class DuelBracket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  /** Rules, schedule, a word about the streamer — free text shown on the page. */
  @Column({ type: 'text', nullable: true, default: null })
  description: string | null;

  /** Optional registration password (stream / Discord); null = open registration. */
  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  password: string | null;

  @Index('IDX_duel_bracket_status')
  @Column({
    type: 'varchar',
    length: 16,
    default: DuelBracketStatus.REGISTRATION,
  })
  status: DuelBracketStatus;

  /** Registration closes at this many players. */
  @Column({ type: 'integer' })
  maxParticipants: number;

  /** Planned start the organiser announced; display only — the launch is manual. */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  scheduledAt: Date | null;

  /** Stream link (http/https) shown on the tournament page. */
  @Column({ type: 'varchar', length: 512, nullable: true, default: null })
  streamUrl: string | null;

  /** Streamer's Telegram / Kick / YouTube / TikTok / Instagram; missing key = not set. */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  streamerLinks: Partial<DuelBracketStreamerLinks>;

  /** Prize places 1–4, sorted by place; `awardedPlayerId` filled at the finish. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  prizes: DuelTournamentPrize[];

  /** How the bracket was seeded at launch; null before. */
  @Column({ type: 'varchar', length: 16, nullable: true, default: null })
  seeding: DuelBracketSeeding | null;

  /** Rounds of the generated bracket (final = last round); 0 before the launch. */
  @Column({ type: 'integer', default: 0 })
  rounds: number;

  @Column({ type: 'uuid', nullable: true, default: null })
  winnerId: string | null;

  /** The organiser; together with admins the only one who may manage it. */
  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => Player, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy: Player | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  startedAt: Date | null;

  /** FINISHED or CANCELLED at. */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  finishedAt: Date | null;

  /** When the prize places were fixed and VIP granted; null until then. */
  @Column({ type: 'timestamptz', nullable: true, default: null })
  prizesAwardedAt: Date | null;
}
