/**
 * What an {@link Asset} depicts. Drives nothing in storage/URL resolution — it is
 * a classification tag so the asset catalog can be filtered/audited by purpose.
 * New rows default to {@link AssetType.Unknown}; producers set a concrete type.
 */
export enum AssetType {
  /** Unclassified — the default for any asset whose purpose isn't recorded. */
  Unknown = 'UNKNOWN',
  /** A team logo / avatar. */
  Team = 'TEAM',
  /** A player avatar. */
  Player = 'PLAYER',
  /** A finance category icon. */
  FinCategory = 'FIN_CATEGORY',
  /** An MMR-update proof screenshot. */
  Proof = 'PROOF',
}
