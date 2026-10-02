import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import {
  DuelCancelReason,
  DuelChallengeStatus,
  DuelFailReason,
  DuelKind,
  DuelState,
} from '../duel.constants';

/** Compact player card used everywhere on the 1v1 ladder. */
export class DuelPlayerDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  discordName: string | null;

  @ApiPropertyOptional({ nullable: true })
  discordUsername: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'SteamID64' })
  steamId: string | null;

  @ApiProperty({ description: 'Current 1v1 ladder rating' })
  rating: number;
}

export class DuelLobbyPlayerDto {
  @ApiProperty()
  playerId: string;

  @ApiProperty()
  steamId64: string;

  @ApiProperty({ description: 'Sits in the Dota lobby right now' })
  present: boolean;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['radiant', 'dire', 'unassigned'],
    description: 'Side taken in the lobby; null when not present',
  })
  side: 'radiant' | 'dire' | 'unassigned' | null;
}

/** Hero assigned to a player of the duel (drawn at random when they were paired). */
export class DuelHeroDto {
  @ApiProperty()
  playerId: string;

  @ApiProperty({ description: 'Valve hero id' })
  heroId: number;

  @ApiProperty({ description: 'Valve internal name, e.g. npc_dota_hero_axe' })
  name: string;

  @ApiProperty({ description: 'Display name, e.g. Axe' })
  localizedName: string;
}

export class DuelStatsPlayerDto {
  @ApiPropertyOptional({ nullable: true })
  playerId: string | null;

  @ApiProperty()
  steamId64: string;

  @ApiPropertyOptional({ nullable: true })
  heroId: number | null;

  @ApiPropertyOptional({ nullable: true })
  kills: number | null;

  @ApiPropertyOptional({ nullable: true })
  deaths: number | null;

  @ApiPropertyOptional({ nullable: true })
  assists: number | null;

  @ApiPropertyOptional({ nullable: true })
  lastHits: number | null;

  @ApiPropertyOptional({ nullable: true })
  denies: number | null;

  @ApiPropertyOptional({ nullable: true })
  netWorth: number | null;

  @ApiPropertyOptional({ nullable: true })
  level: number | null;

  @ApiPropertyOptional({ nullable: true })
  isRadiant: boolean | null;

  @ApiPropertyOptional({ nullable: true })
  win: boolean | null;
}

/** Last live scoreboard snapshot the bot captured (best effort, may be absent). */
export class DuelStatsDto {
  @ApiPropertyOptional({ nullable: true })
  durationSeconds: number | null;

  @ApiProperty({ type: [DuelStatsPlayerDto] })
  players: DuelStatsPlayerDto[];
}

/** Name tag of a tournament, attached to its duels and queue entries. */
export class DuelTournamentRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class DuelDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Human-readable duel number ("Duel #N")' })
  number: number;

  @ApiProperty({ enum: DuelState })
  state: DuelState;

  @ApiProperty({
    enum: DuelKind,
    description:
      '`ranked` — paired from the queue (±25); `friend` — created from an accepted friend challenge (±10); ' +
      '`tournament` — paired from a tournament queue (±25 on the tournament table)',
  })
  kind: DuelKind;

  @ApiPropertyOptional({
    type: DuelTournamentRefDto,
    nullable: true,
    description: 'Tournament of a `tournament` duel; null otherwise',
  })
  tournament: DuelTournamentRefDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  lobbyReadyAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  liveAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  finishedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'Both players must sit on a side before this moment (lobbyReadyAt + join timeout)',
  })
  joinDeadlineAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'Both players must accept before this moment (ACCEPTING only, 30 s after pairing)',
  })
  acceptDeadlineAt: Date | null;

  @ApiProperty({
    type: [String],
    description: 'Players who already pressed Accept',
  })
  acceptedPlayerIds: string[];

  @ApiPropertyOptional({ type: DuelPlayerDto, nullable: true })
  player1: DuelPlayerDto | null;

  @ApiPropertyOptional({ type: DuelPlayerDto, nullable: true })
  player2: DuelPlayerDto | null;

  @ApiProperty({ description: 'Rating of player1 when they were paired' })
  player1Rating: number;

  @ApiProperty({ description: 'Rating of player2 when they were paired' })
  player2Rating: number;

  @ApiProperty()
  lobbyName: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Only for the two participants while the lobby is open; null for everyone else',
  })
  lobbyPassword: string | null;

  @ApiPropertyOptional({
    type: [DuelHeroDto],
    nullable: true,
    description:
      'Random hero per player, drawn at pairing time; picking another hero forfeits the duel',
  })
  heroes: DuelHeroDto[] | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Link to the private Discord voice channel of this duel ("Duel #N"). ' +
      'Only for the two participants from the moment both accepted until the duel ended; null for everyone else',
  })
  discordVoiceChannelUrl: string | null;

  @ApiPropertyOptional({ type: [DuelLobbyPlayerDto], nullable: true })
  lobbyPlayers: DuelLobbyPlayerDto[] | null;

  @ApiPropertyOptional({ nullable: true })
  radiantPlayerId: string | null;

  @ApiPropertyOptional({ nullable: true })
  direPlayerId: string | null;

  @ApiPropertyOptional({ nullable: true })
  winnerId: string | null;

  @ApiPropertyOptional({ nullable: true })
  loserId: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Valve match id' })
  dotaMatchId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Points moved once the result was applied (25 for ranked, 10 for friendly duels)',
  })
  ratingDelta: number | null;

  @ApiPropertyOptional({ nullable: true, enum: DuelCancelReason })
  cancelReason: DuelCancelReason | null;

  @ApiPropertyOptional({ nullable: true, enum: DuelFailReason })
  failReason: DuelFailReason | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Who cancelled the duel (player or admin); null for automatic cancels',
  })
  cancelledById: string | null;

  @ApiProperty()
  adminReviewRequired: boolean;

  @ApiProperty({
    description:
      'How many times the lobby was relaunched because the game never started (a player failed to load)',
  })
  lobbyRestarts: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Dota game_state last seen on the live scoreboard while LIVE (0/1/10 = still loading, ' +
      '2 = hero selection, 5 = in progress); null before the first snapshot or after a relaunch',
  })
  gameState: number | null;

  @ApiPropertyOptional({ type: DuelStatsDto, nullable: true })
  stats: DuelStatsDto | null;
}

export class DuelRatingDto {
  @ApiProperty()
  playerId: string;

  @ApiProperty()
  rating: number;

  @ApiProperty()
  wins: number;

  @ApiProperty()
  losses: number;

  @ApiProperty({ description: 'Positive = win streak, negative = loss streak' })
  streak: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Win rate 0–100, rounded; null before the first duel',
  })
  winrate: number | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  lastPlayedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  cooldownUntil: Date | null;
}

export class DuelQueueStateDto {
  @ApiProperty({ type: String, format: 'date-time' })
  joinedAt: Date;

  @ApiProperty({ description: 'Seconds spent in the queue so far' })
  waitSeconds: number;

  @ApiProperty({
    description: 'Current ± rating window used to find an opponent',
  })
  window: number;

  @ApiProperty({
    description:
      'Everyone currently waiting in the same queue (ladder or tournament), including the caller',
  })
  playersInQueue: number;

  @ApiPropertyOptional({
    type: DuelTournamentRefDto,
    nullable: true,
    description:
      'Tournament whose queue the player waits in; null for the ladder queue (no rating window there)',
  })
  tournament: DuelTournamentRefDto | null;
}

export class JoinDuelQueueDto {
  @ApiPropertyOptional({
    description:
      'Queue of this tournament instead of the ladder (the player must have joined it with the password)',
  })
  @IsOptional()
  @IsUUID()
  tournamentId?: string;
}

export enum DuelQueueBlockedReason {
  STEAM_NOT_LINKED = 'steam_not_linked',
  COOLDOWN = 'cooldown',
  ACTIVE_DUEL = 'active_duel',
  ALREADY_QUEUED = 'already_queued',
  NO_BOTS_ONLINE = 'no_bots_online',
}

/** Public host-bot pool summary shown next to the queue. */
export class DuelBotsStatusDto {
  @ApiProperty({ description: 'Enabled, non-banned bots' })
  total: number;

  @ApiProperty({ description: 'Bots whose worker is alive (FREE + BUSY)' })
  online: number;

  @ApiProperty()
  free: number;

  @ApiProperty()
  busy: number;
}

/** A friendly-duel invitation between two friends. */
export class DuelChallengeDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: DuelChallengeStatus })
  status: DuelChallengeStatus;

  @ApiProperty({ type: DuelPlayerDto, description: 'Who sent the challenge' })
  challenger: DuelPlayerDto;

  @ApiProperty({ type: DuelPlayerDto, description: 'Who was challenged' })
  challenged: DuelPlayerDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'A PENDING challenge nobody answered by then expires',
  })
  expiresAt: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  respondedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'The friendly duel created once the challenge was accepted',
  })
  duelId: string | null;
}

/** My open challenges plus how many friendly duels I may still accept today. */
export class DuelChallengesStateDto {
  @ApiProperty({
    type: [DuelChallengeDto],
    description: 'Challenges waiting for my answer',
  })
  incoming: DuelChallengeDto[];

  @ApiPropertyOptional({
    type: DuelChallengeDto,
    nullable: true,
    description: 'The challenge I sent that is still open (one at a time)',
  })
  outgoing: DuelChallengeDto | null;

  @ApiProperty({
    description: 'Friendly duels I accepted (either side) today, Kyiv time',
  })
  acceptedToday: number;

  @ApiProperty({ description: 'Friendly duels a player may accept per day' })
  dailyLimit: number;

  @ApiProperty({
    description:
      'VIP: friendly duels are not limited per day (for duels with a VIP on either side)',
  })
  unlimited: boolean;

  @ApiProperty({ description: 'Points a friendly duel moves (10)' })
  ratingDelta: number;
}

export class CreateDuelChallengeDto {
  @ApiProperty({ description: 'Friend to challenge' })
  @IsUUID()
  playerId: string;
}

/** Everything the /1v1 page needs; polled every few seconds while queued or in a duel. */
export class DuelStatusDto {
  @ApiProperty({ type: DuelRatingDto })
  rating: DuelRatingDto;

  @ApiPropertyOptional({ type: DuelQueueStateDto, nullable: true })
  queue: DuelQueueStateDto | null;

  @ApiPropertyOptional({ type: DuelDto, nullable: true })
  activeDuel: DuelDto | null;

  @ApiPropertyOptional({
    type: DuelDto,
    nullable: true,
    description:
      'Most recent finished duel — terminal, or PROCESSING (game over, result still being collected); the UI shows it as a result banner',
  })
  lastFinishedDuel: DuelDto | null;

  @ApiProperty({
    description: 'Whether POST /duels/queue would succeed right now',
  })
  canQueue: boolean;

  @ApiPropertyOptional({ nullable: true, enum: DuelQueueBlockedReason })
  queueBlockedReason: DuelQueueBlockedReason | null;

  @ApiProperty({
    description:
      'Players in the 1v1 queue right now (me included when queued) — shown even outside the queue',
  })
  playersInQueue: number;

  @ApiProperty({
    type: DuelBotsStatusDto,
    description:
      'Host bot pool snapshot; queueing is blocked while online is 0',
  })
  bots: DuelBotsStatusDto;

  @ApiProperty({
    type: DuelChallengesStateDto,
    description: 'Friendly-duel challenges: open ones and the daily counter',
  })
  challenges: DuelChallengesStateDto;
}

export class DuelLeaderboardRowDto {
  @ApiProperty({ description: '1-based rank on the board' })
  position: number;

  @ApiProperty({ type: DuelPlayerDto })
  player: DuelPlayerDto;

  @ApiProperty()
  rating: number;

  @ApiProperty()
  wins: number;

  @ApiProperty()
  losses: number;

  @ApiPropertyOptional({ nullable: true })
  winrate: number | null;

  @ApiProperty()
  streak: number;

  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  lastPlayedAt: Date | null;
}

export class DuelLeaderboardDto {
  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt: Date;

  @ApiProperty({ type: [DuelLeaderboardRowDto] })
  players: DuelLeaderboardRowDto[];
}

export class DuelPlayerProfileDto {
  @ApiPropertyOptional({
    type: DuelRatingDto,
    nullable: true,
    description: 'null until the player queued at least once',
  })
  rating: DuelRatingDto | null;

  @ApiProperty({ type: [DuelDto], description: 'Last 10 duels, newest first' })
  recent: DuelDto[];
}
