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
  /**
   * The game server took over and the GC dropped the bot from the lobby: for
   * the players the match is over (they may queue again), while the platform
   * still collects the result from the live scoreboard / Web API.
   */
  PROCESSING = 'PROCESSING',
  /** Result received from the Game Coordinator, rating applied. */
  RESOLVED = 'RESOLVED',
  /** No-show, no free bot, admin cancel — no game was played. */
  CANCELLED = 'CANCELLED',
  /** Technical failure mid-duel; needs an admin decision. */
  FAILED = 'FAILED',
}

/** States that block the queue and show as "my active duel"; PROCESSING is deliberately not one of them. */
export const DUEL_ACTIVE_STATES: readonly DuelState[] = [
  DuelState.ACCEPTING,
  DuelState.PENDING,
  DuelState.LOBBY_CREATING,
  DuelState.WAITING_PLAYERS,
  DuelState.LIVE,
];

/** States in which a duel may still change a board (its result is not applied yet). */
export const DUEL_RUNNING_STATES: readonly DuelState[] = [
  ...DUEL_ACTIVE_STATES,
  DuelState.PROCESSING,
];

/** States a host bot owns — what a restarted worker must reconcile. */
export const DUEL_HOSTED_STATES: readonly DuelState[] = [
  DuelState.LOBBY_CREATING,
  DuelState.WAITING_PLAYERS,
  DuelState.LIVE,
  DuelState.PROCESSING,
];

export const DUEL_TERMINAL_STATES: readonly DuelState[] = [
  DuelState.RESOLVED,
  DuelState.CANCELLED,
  DuelState.FAILED,
];

/**
 * States in which the duel's Discord voice channel exists and its link is
 * shown to the two players: from "both accepted" until the result is in.
 * PROCESSING is included on purpose — the players are in the game then.
 */
export const DUEL_VOICE_CHANNEL_STATES: readonly DuelState[] = [
  DuelState.PENDING,
  DuelState.LOBBY_CREATING,
  DuelState.WAITING_PLAYERS,
  DuelState.LIVE,
  DuelState.PROCESSING,
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
  /**
   * The launched game never started (a player failed to load, the server
   * aborted the match) and the lobby could not be restarted any more.
   * No rating change.
   */
  GAME_ABORTED = 'game_aborted',
  /** The duel's tournament was ended before the game started. No rating change. */
  TOURNAMENT_ENDED = 'tournament_ended',
  /** An admin deleted the duel's tournament before the game started. No rating change. */
  TOURNAMENT_DELETED = 'tournament_deleted',
  /** The ladder season ended before the game started. No rating change. */
  SEASON_ENDED = 'season_ended',
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

/** Where a duel came from — decides how many points it moves. */
export enum DuelKind {
  /** Paired by the matchmaker from the queue: ±DUEL_RATING_DELTA. */
  RANKED = 'ranked',
  /** Created from an accepted friend challenge: ±DUEL_FRIEND_RATING_DELTA, never re-queues anyone. */
  FRIEND = 'friend',
  /**
   * Paired from a tournament queue: ±DUEL_RATING_DELTA on the tournament's
   * own table (`duel_tournament_participant`), the global ladder is untouched.
   */
  TOURNAMENT = 'tournament',
}

/** A password-protected tournament run by media staff / admins. */
export enum DuelTournamentStatus {
  /** Players may join with the password and queue. */
  ACTIVE = 'ACTIVE',
  /** Frozen: no joins, no queue; the leaderboard stays public. */
  ENDED = 'ENDED',
}

/** What a prize place of a tournament gives. */
export enum DuelTournamentPrizeKind {
  /** `vipMonths` of VIP, granted automatically once the tournament is over. Admins only. */
  VIP = 'vip',
  /** Image + link set by the organiser; handed out by the organiser. */
  CUSTOM = 'custom',
}

/**
 * One prize place of a tournament (`duel_tournament.prizes`, jsonb).
 * `awardedPlayerId` is filled when the prizes are settled: the player who held
 * the place then (null — nobody with a played game held it).
 */
export interface DuelTournamentPrize {
  place: number;
  kind: DuelTournamentPrizeKind;
  vipMonths: number | null;
  title: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  awardedPlayerId: string | null;
}

/** Prize places per tournament. */
export const DUEL_TOURNAMENT_PRIZES_MAX = 10;
/** Lowest place a prize may be put on. */
export const DUEL_TOURNAMENT_PRIZE_PLACE_MAX = 100;
/** VIP months one prize place may give. */
export const DUEL_TOURNAMENT_PRIZE_VIP_MONTHS_MAX = 12;
/** How often api-v1 retries settling the prizes of ended tournaments (their last games may still run). */
export const DUEL_TOURNAMENT_PRIZES_SWEEP_MS = 60_000;

/** A monthly season of the ladder (`duel_season`). */
export enum DuelSeasonStatus {
  /** The live season: ranked and friendly duels count for it. */
  ACTIVE = 'ACTIVE',
  /** Over: its final table is frozen in `duel_season_standing`. */
  ENDED = 'ENDED',
}

/**
 * One prize place of a season (`duel_season.prizes`, jsonb): a tournament
 * prize plus who handed it out. VIP places get `issuedAt` when the VIP was
 * granted automatically; custom places when an admin marks them as issued.
 */
export interface DuelSeasonPrize extends DuelTournamentPrize {
  issuedAt: string | null;
  /** Admin who marked a custom prize issued; null for automatic VIP grants. */
  issuedById: string | null;
}

/** Seasons are Kyiv calendar months. */
export const DUEL_SEASON_TIME_ZONE = 'Europe/Kyiv';
/** How often api-v1 checks whether the season is over (and retries settling prizes). */
export const DUEL_SEASON_SWEEP_MS = 60_000;
/**
 * How long the rollover waits for the season's games that were already
 * running at its end. Past that it closes anyway; a later result of such a
 * game changes no rating (see `DuelsService.ratingLine`).
 */
export const DUEL_SEASON_FINISH_GRACE_MS = 2 * 60 * 60 * 1000;

/** Wrong tournament passwords a player may try per tournament within the window. */
export const DUEL_TOURNAMENT_JOIN_MAX_ATTEMPTS = 10;
export const DUEL_TOURNAMENT_JOIN_WINDOW_SECONDS = 10 * 60;

export enum DuelChallengeStatus {
  PENDING = 'PENDING',
  /** The challenged friend accepted — `duelId` points at the friendly duel. */
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  /** Withdrawn by the challenger. */
  CANCELLED = 'CANCELLED',
  /** Nobody answered within DUEL_CHALLENGE_TTL_SECONDS. */
  EXPIRED = 'EXPIRED',
}

/** Rating rules (decisions 7, 14, 15, 19). */
export const DUEL_RATING_DELTA = 25;
/** Points moved by a friendly duel (challenge between friends). */
export const DUEL_FRIEND_RATING_DELTA = 10;
/** Points a duel of this kind moves between winner and loser (and costs an absent player). */
export const duelRatingDeltaFor = (
  kind: DuelKind | null | undefined,
): number =>
  kind === DuelKind.FRIEND ? DUEL_FRIEND_RATING_DELTA : DUEL_RATING_DELTA;
/** How many friendly duels a player may accept (either side) per Kyiv calendar day. */
export const DUEL_CHALLENGE_DAILY_LIMIT = 3;
/** How long a friend challenge waits for an answer. */
export const DUEL_CHALLENGE_TTL_SECONDS = 5 * 60;
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
export const DUEL_LOBBY_LOST_GRACE_SECONDS = 180;
/** The result is asked for this long after the game ended (lets the GC sign the match out). */
export const DUEL_RESULT_DELAY_SECONDS = 5;
/** How often the bot re-asks the GC for match details while the outcome is unknown. */
export const DUEL_GC_DETAILS_INTERVAL_SECONDS = 10;
/** FAILED duels with a Valve match id are retried against the Web API for this long after they finished. */
export const DUEL_RESULT_RECOVERY_WINDOW_SECONDS = 24 * 3600;
/** POSTGAME without `match_outcome`: wait this long for the GC to fill it in. */
export const DUEL_POSTGAME_OUTCOME_WAIT_SECONDS = 180;
/**
 * How many times the bot relaunches a lobby whose game never started (a
 * player failed to load). One more abort after that cancels the duel.
 */
export const DUEL_MAX_LOBBY_RESTARTS = 2;
/** After an aborted launch: let the clients settle before the lobby is launched again. */
export const DUEL_RELAUNCH_DELAY_SECONDS = 10;
/**
 * Lobby invites get lost now and then. While a player is still missing from
 * the lobby the bot re-sends the invite this often…
 */
export const DUEL_REINVITE_INTERVAL_SECONDS = 30;
/** …at most this many times on its own; the player can ask for more from the site. */
export const DUEL_REINVITE_MAX_AUTO = 4;
/** "Invite me again" from the site: once per player per this many seconds. */
export const DUEL_INVITE_REQUEST_COOLDOWN_SECONDS = 15;
/** "Restart the match" from the site: once per player per this many seconds. */
export const DUEL_RESTART_REQUEST_COOLDOWN_SECONDS = 60;
/**
 * A player may ask for a restart only this long after the launch. A game that
 * never started is aborted by the server well within it; past it the match
 * is assumed to be running (a losing player must not be able to void it).
 */
export const DUEL_RESTART_REQUEST_WINDOW_SECONDS = 10 * 60;
/**
 * `DOTA_GameState` values a match sits in before the game proper: INIT,
 * WAIT_FOR_PLAYERS_TO_LOAD, WAIT_FOR_MAP_TO_LOAD. Hero selection (2) and
 * everything after it mean the picks are on — no restart from then on.
 */
export const DUEL_NEVER_STARTED_GAME_STATES: ReadonlySet<number> = new Set([
  0, 1, 10,
]);

// ── Discord voice channel ────────────────────────────────────────────────

/** A finished duel keeps its voice channel this long, so the players can say "gg" before it vanishes. */
export const DUEL_VOICE_CHANNEL_GRACE_SECONDS = 120;
/** How often api-v1 re-checks channels against duel states (missed events, restarts, grace expiry). */
export const DUEL_VOICE_CHANNEL_SWEEP_MS = 30_000;

// ── realtime (socket.io) ─────────────────────────────────────────────────

/** socket.io namespace the duels page connects to (`<api origin>/duels`). */
export const DUEL_SOCKET_NAMESPACE = 'duels';
/** A connected socket is the queue heartbeat: rows of connected players are refreshed this often (well inside the TTL). */
export const DUEL_SOCKET_HEARTBEAT_SECONDS = 5;
/** Change notifications for the same player arriving within this window are merged into one status push. */
export const DUEL_SOCKET_REFRESH_DEBOUNCE_MS = 150;
