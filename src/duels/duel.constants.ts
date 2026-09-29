/**
 * Shared constants of the 1v1 ladder. Both api-v1 (queue, matchmaker, HTTP)
 * and the bot-worker process (lobby state machine) import from here so the
 * two never disagree on a state name or a rule.
 */

export enum DuelState {
  /** Paired by the matchmaker, waiting for both players to press Accept (30 s). */
  ACCEPTING = 'ACCEPTING',
  /** Both accepted, waiting for a free host bot. */
  PENDING = 'PENDING',
  /** A bot claimed the duel and is creating the lobby. */
  LOBBY_CREATING = 'LOBBY_CREATING',
  /** Lobby exists, invites sent, waiting for both players to take a side. */
  WAITING_PLAYERS = 'WAITING_PLAYERS',
  /** Game launched. */
  LIVE = 'LIVE',
  /** Result received from the Game Coordinator, rating applied. */
  RESOLVED = 'RESOLVED',
  /** No-show, no free bot, admin cancel — no game was played. */
  CANCELLED = 'CANCELLED',
  /** Technical failure mid-duel; needs an admin decision. */
  FAILED = 'FAILED',
}

export const DUEL_ACTIVE_STATES: readonly DuelState[] = [
  DuelState.ACCEPTING,
  DuelState.PENDING,
  DuelState.LOBBY_CREATING,
  DuelState.WAITING_PLAYERS,
  DuelState.LIVE,
];

export const DUEL_TERMINAL_STATES: readonly DuelState[] = [
  DuelState.RESOLVED,
  DuelState.CANCELLED,
  DuelState.FAILED,
];

export enum DuelCancelReason {
  PLAYERS_NO_SHOW = 'players_no_show',
  LOBBY_NOT_CREATED = 'lobby_not_created',
  NO_BOTS_AVAILABLE = 'no_bots_available',
  ADMIN = 'admin',
  /** At least one player did not press Accept in time. */
  ACCEPT_TIMEOUT = 'accept_timeout',
  /** A participant cancelled before the game started (−10 for them). */
  PLAYER_CANCELLED = 'player_cancelled',
}

/** States in which a participant may still cancel the duel themselves. */
export const DUEL_PLAYER_CANCELLABLE_STATES: readonly DuelState[] = [
  DuelState.ACCEPTING,
  DuelState.PENDING,
  DuelState.LOBBY_CREATING,
  DuelState.WAITING_PLAYERS,
];

export enum DuelFailReason {
  LOBBY_LOST = 'lobby_lost',
  GAME_TIMEOUT = 'game_timeout',
  UNDETERMINED_OUTCOME = 'undetermined_outcome',
  /** Both players ignored their assigned heroes — an admin decides. */
  WRONG_HEROES = 'wrong_heroes',
}

/** Hero drawn for a player of a duel; the player must pick exactly this hero. */
export interface DuelHeroPick {
  playerId: string;
  heroId: number;
}

export type DuelLobbySide = 'radiant' | 'dire' | 'unassigned';

/** One invited player's presence in the Dota lobby, as the bot sees it. */
export interface DuelLobbyPlayer {
  playerId: string;
  steamId64: string;
  present: boolean;
  side: DuelLobbySide | null;
}

/** Per-player line of the live scoreboard snapshot the bot captured. */
export interface DuelStatsPlayer {
  playerId: string | null;
  steamId64: string;
  heroId: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  lastHits: number | null;
  denies: number | null;
  netWorth: number | null;
  level: number | null;
  isRadiant: boolean | null;
  win: boolean | null;
}

export interface DuelStats {
  durationSeconds: number | null;
  players: DuelStatsPlayer[];
}

export enum HostBotStatus {
  /** Not logged in / GC not ready. */
  OFFLINE = 'OFFLINE',
  /** Logged in, GC ready, no duel. */
  FREE = 'FREE',
  /** Hosting a duel. */
  BUSY = 'BUSY',
  /** Dead account, never loaded into the pool. */
  BANNED = 'BANNED',
}

/** Valve `EMatchOutcome`: who won. */
export const MATCH_OUTCOME_RADIANT = 2;
export const MATCH_OUTCOME_DIRE = 3;

/** Rating rules (decisions 7, 14, 15, 19). */
export const DUEL_RATING_DELTA = 25;
export const DUEL_RATING_FLOOR = 0;
export const DUEL_QUEUE_WINDOW_BASE = 50;
export const DUEL_QUEUE_WINDOW_STEP = 50;
export const DUEL_QUEUE_WINDOW_STEP_SECONDS = 30;
/** Queue rows not refreshed by `GET /duels/me` for this long are dropped. */
export const DUEL_QUEUE_HEARTBEAT_TTL_SECONDS = 20;
/** A PENDING duel nobody claimed for this long is cancelled and both players re-queued. */
export const DUEL_PENDING_TIMEOUT_SECONDS = 5 * 60;
export const DUEL_NO_SHOW_COOLDOWN_SECONDS = 5 * 60;
export const DUEL_SAME_OPPONENT_DAILY_LIMIT = 3;
/** Points a player loses for cancelling their duel or not accepting a found match. */
export const DUEL_CANCEL_PENALTY = 10;
/** How long both players have to press Accept after being paired. */
export const DUEL_ACCEPT_WINDOW_SECONDS = 30;

/** Lobby rules (decisions 11, 26). Env overrides live in the bot worker. */
export const DUEL_DEFAULT_REGION = 3; // EU West
export const DUEL_JOIN_TIMEOUT_SECONDS = 300;
export const DUEL_GAME_TIMEOUT_SECONDS = 90 * 60;
export const DUEL_LOBBY_NAME_DEFAULT = 'Core League 1v1';
/**
 * Dota game mode of the hosted lobby (`DOTA_GameMode`): 21 = 1v1 Solo Mid.
 * Dota has no "random heroes" switch for this mode, so the league draws a
 * random hero per player at pairing time (`duel.heroes`) and the bot checks
 * the picked heroes at the end of the game. Env override: `HOSTBOT_GAME_MODE`.
 */
export const DUEL_DEFAULT_GAME_MODE = 21;
/** After the game launched, how long a vanished lobby may stay missing before we give up on the GC. */
export const DUEL_LOBBY_LOST_GRACE_SECONDS = 120;
/** POSTGAME without `match_outcome`: wait this long for the GC to fill it in. */
export const DUEL_POSTGAME_OUTCOME_WAIT_SECONDS = 60;
