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

export interface NotificationPayload {
  actor?: NotificationActor;
  /** Friendly duel created from an accepted challenge. */
  duelId?: string;
  /** ISO date until which a challenge can be answered. */
  expiresAt?: string;
}

/** socket.io namespace of the header bell (`<api origin>/notifications`). */
export const NOTIFICATION_SOCKET_NAMESPACE = 'notifications';
/** How many newest entries the inbox snapshot carries. */
export const NOTIFICATION_SNAPSHOT_LIMIT = 30;
