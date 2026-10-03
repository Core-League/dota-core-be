/**
 * Shared constants of the notification center. api-v1 writes the rows and
 * pushes them through the `/notifications` socket namespace.
 */

export enum NotificationType {
  /** Someone sent the player a friend request (actionable). */
  FRIEND_REQUEST = 'friend_request',
  /** A friend request the player sent was accepted. */
  FRIEND_REQUEST_ACCEPTED = 'friend_request_accepted',
  /** A friend challenged the player to a friendly duel (actionable). */
  DUEL_CHALLENGE = 'duel_challenge',
  DUEL_CHALLENGE_ACCEPTED = 'duel_challenge_accepted',
  DUEL_CHALLENGE_DECLINED = 'duel_challenge_declined',
  DUEL_CHALLENGE_EXPIRED = 'duel_challenge_expired',
  /** A player applied to the team's recruitment post (actionable, to captain + coach). */
  TEAM_APPLICATION = 'team_application',
  TEAM_APPLICATION_ACCEPTED = 'team_application_accepted',
  TEAM_APPLICATION_DECLINED = 'team_application_declined',
  /** A team invited the player (actionable). */
  TEAM_INVITE = 'team_invite',
  TEAM_INVITE_ACCEPTED = 'team_invite_accepted',
  TEAM_INVITE_DECLINED = 'team_invite_declined',
  /** The player won a prize place of a finished duel season. */
  DUEL_SEASON_PRIZE = 'duel_season_prize',
}

/** Outcome of the request / challenge an actionable notification is about. */
export enum NotificationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

/** Compact card of the player who triggered the notification. */
export interface NotificationActor {
  id: string;
  discordName: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
}

/** Compact card of the team a recruitment notification is about. */
export interface NotificationTeam {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface NotificationPayload {
  actor?: NotificationActor;
  /** Team of a `team_application*` / `team_invite*` entry. */
  team?: NotificationTeam;
  /** Friendly duel created from an accepted challenge. */
  duelId?: string;
  /** ISO date until which a challenge can be answered. */
  expiresAt?: string;
  /** Prize place won in a duel season (`duel_season_prize`). */
  seasonPrize?: NotificationSeasonPrize;
}

/** What a `duel_season_prize` entry says: the season, the place and the prize in words. */
export interface NotificationSeasonPrize {
  seasonNumber: number;
  place: number;
  /** «VIP на 3 міс.» or the custom prize title. */
  prize: string;
}

/** socket.io namespace of the header bell (`<api origin>/notifications`). */
export const NOTIFICATION_SOCKET_NAMESPACE = 'notifications';
/** How many newest entries the inbox snapshot carries. */
export const NOTIFICATION_SNAPSHOT_LIMIT = 30;
