export enum FriendshipStatus {
  /** Request sent, waiting for the addressee. */
  PENDING = 'PENDING',
  /** Both players are friends. */
  ACCEPTED = 'ACCEPTED',
}

/** How the caller relates to another player (derived, never stored). */
export enum FriendRelation {
  NONE = 'none',
  FRIENDS = 'friends',
  /** The other player asked the caller. */
  INCOMING = 'incoming',
  /** The caller asked the other player. */
  OUTGOING = 'outgoing',
}
