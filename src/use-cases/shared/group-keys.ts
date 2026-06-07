/**
 * `groupKey` conventions for persisted `operation_group` rows. The key is unique
 * per (kind, key) and identifies what an automatic group collapses, so the same
 * team / sponsor / catch-all always maps to one stable group.
 */

/** PRIZE group for a resolved team. */
export const teamGroupKey = (teamId: string): string => `team:${teamId}`;

/** SPONSOR group for a matched sponsor. */
export const sponsorGroupKey = (sponsorId: string): string =>
  `sponsor:${sponsorId}`;

/** Single PRIZE catch-all for gifts whose team could not be resolved. */
export const OTHER_GIFTS_GROUP_KEY = 'gift:other';
