import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Player } from '../players/player.entity';
import {
  DuelKind,
  DuelState,
  type DuelCancelReason,
  type DuelFailReason,
  type DuelHeroPick,
  type DuelLobbyPlayer,
  type DuelStats,
} from './duel.constants';

/**
 * One 1v1 Solo Mid duel: created by the matchmaker as PENDING, claimed and
 * driven to a terminal state by a host bot in the bot-worker process, read by
 * the API for the queue view, history and the leaderboard.
 */
@Entity('duel')
export class Duel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Human-readable "Duel #N" — a sequence, unique across the whole ladder history. */
  @Index('IDX_duel_number', { unique: true })
  @Generated('increment')
  @Column({ type: 'integer' })
  number: number;

  @Index('IDX_duel_state')
  @Column({ type: 'varchar', length: 24, default: DuelState.PENDING })
  state: DuelState;

  /** `ranked` from the queue (±25) or `friend` from an accepted challenge (±10). */
  @Index('IDX_duel_kind')
  @Column({ type: 'varchar', length: 16, default: DuelKind.RANKED })
  kind: DuelKind;

  @Index('IDX_duel_player1')
  @Column({ type: 'uuid', nullable: true })
  player1Id: string | null;

  @ManyToOne(() => Player, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'player1Id' })
  player1: Player | null;

  @Index('IDX_duel_player2')
  @Column({ type: 'uuid', nullable: true })
  player2Id: string | null;

  @ManyToOne(() => Player, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'player2Id' })
  player2: Player | null;

  /** 1v1 ratings at pairing time — what the leaderboard row looked like when they met. */
  @Column({ type: 'integer', default: 0 })
  player1Rating: number;

  @Column({ type: 'integer', default: 0 })
  player2Rating: number;

  /** `host_bot.id` of the bot that claimed the duel; null while PENDING. */
  @Column({ type: 'integer', nullable: true })
  hostBotId: number | null;

  /** Dota lobby id from the Game Coordinator (uint64 as string). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  lobbyId: string | null;

  /** Game server SteamID once the match launched — the live scoreboard is keyed by it. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  serverSteamId: string | null;

  @Column({ type: 'varchar', length: 64 })
  lobbyName: string;

  @Column({ type: 'varchar', length: 32 })
  lobbyPassword: string;

  /** Valve `server_region` (3 = EU West). */
  @Column({ type: 'integer', default: 3 })
  region: number;

  /** Random heroes drawn at pairing time — one per player, both must pick theirs. */
  @Column({ type: 'jsonb', nullable: true })
  heroes: DuelHeroPick[] | null;

  /** Presence of the two invited players in the lobby, refreshed by the bot on change. */
  @Column({ type: 'jsonb', nullable: true })
  lobbyPlayers: DuelLobbyPlayer[] | null;

  /** Sides at launch — the authoritative source for who won. */
  @Column({ type: 'uuid', nullable: true })
  radiantPlayerId: string | null;

  @Column({ type: 'uuid', nullable: true })
  direPlayerId: string | null;

  @Column({ type: 'uuid', nullable: true })
  winnerId: string | null;

  @Column({ type: 'uuid', nullable: true })
  loserId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  dotaMatchId: string | null;

  /** Valve `EMatchOutcome` (2 Radiant, 3 Dire). */
  @Column({ type: 'integer', nullable: true })
  matchOutcome: number | null;

  /** Points moved between the players (25) once the result was applied. */
  @Column({ type: 'integer', nullable: true })
  ratingDelta: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  ratingAppliedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  stats: DuelStats | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** How many times the lobby was relaunched after a game that never started (player failed to load). */
  @Column({ type: 'integer', default: 0 })
  lobbyRestarts: number;

  /**
   * "Invite me again" requests from the site: player id → ISO time of the
   * latest one. The host bot serves each new request on its next tick.
   */
  @Column({ type: 'jsonb', nullable: true })
  inviteRequests: Record<string, string> | null;

  /**
   * Private Discord voice channel of the two players ("Duel #N"), created by
   * api-v1 once both accepted and deleted after the duel ended.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  discordVoiceChannelId: string | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  cancelReason: DuelCancelReason | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  failReason: DuelFailReason | null;

  /** FAILED duels wait here until an admin resolves or voids them. */
  @Column({ type: 'boolean', default: false })
  adminReviewRequired: boolean;

  @Column({ type: 'uuid', nullable: true })
  resolvedByAdminId: string | null;

  @Index('IDX_duel_created')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  /** ACCEPTING: both players must press Accept before this moment. */
  @Column({ type: 'timestamptz', nullable: true })
  acceptDeadlineAt: Date | null;

  /** Players who already pressed Accept. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  acceptedPlayerIds: string[];

  /** Who cancelled (participant or admin); null for automatic cancels. */
  @Column({ type: 'uuid', nullable: true })
  cancelledById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lobbyReadyAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  liveAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
