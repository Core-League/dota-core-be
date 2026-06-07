import { z } from 'zod';

/**
 * A row in the operations feed. The feed flattens several sources into one shape:
 * a standalone operation, a collapsed group (a persisted `operation_group` row of
 * either `PRIZE` or `CUSTOM` kind), and (when forecast is on) two virtual forecast
 * rows. `sign` is derived from the amount and drives color in presentation
 * (`POSITIVE` = green, `NEGATIVE` = red); nothing about color is persisted.
 *
 * Group rows (`kind === GROUP`) carry their member operations nested under
 * `children`, the member `count`, and the discriminating `groupKind`. Every row
 * (top-level and child) carries its assigned `category` or null.
 */
export enum FeedItemKind {
  Operation = 'OPERATION',
  Group = 'GROUP',
  Forecast = 'FORECAST',
}

export enum FeedItemSign {
  Positive = 'POSITIVE',
  Negative = 'NEGATIVE',
}

/** What a GROUP row collapses; null for non-group rows. */
export enum FeedGroupKind {
  /** A PRIZE group resolved to a real team. */
  TeamGift = 'TEAM_GIFT',
  /** The PRIZE catch-all for gifts whose team could not be resolved. */
  OtherGifts = 'OTHER_GIFTS',
  /** A SPONSOR group (one per matched sponsor). */
  Sponsor = 'SPONSOR',
  /** A user-assembled CUSTOM group. */
  Manual = 'MANUAL',
}

/** The category assigned to a feed row, resolved for display. */
export const FeedCategoryRefSchema = z.object({
  id: z.string(),
  label: z.string(),
  iconUrl: z.string().nullable(),
});

export type FeedCategoryRef = z.infer<typeof FeedCategoryRefSchema>;

/** Base shape shared by every feed row; `children` is added via `z.lazy` below. */
const FeedItemBaseSchema = z.object({
  kind: z.enum(FeedItemKind),
  id: z.string(),
  amount: z.number().int(),
  sign: z.enum(FeedItemSign),
  time: z.date().nullable(),
  title: z.string(),
  /** Resolved icon URL (operation icon, team logo, or group icon), or null. */
  iconUrl: z.string().nullable(),
  /** Member operation ids for a GROUP row; empty otherwise. */
  operationIds: z.array(z.string()).default([]),
  /** What a GROUP row collapses; null for OPERATION/FORECAST rows. */
  groupKind: z.enum(FeedGroupKind).nullable().default(null),
  /**
   * The group's stable key for a GROUP row; null otherwise. Prefixed by kind:
   * `team:<teamId>` (TEAM_GIFT — strip the prefix for the team-page link),
   * `sponsor:<sponsorId>`, `gift:other` (OTHER_GIFTS), or `custom:<ts>` (MANUAL).
   */
  groupKey: z.string().nullable().default(null),
  /** Member count for a GROUP row; 0 otherwise. */
  count: z.number().int().default(0),
  /** Assigned category (resolved), or null. */
  category: FeedCategoryRefSchema.nullable().default(null),
  /** Whether this row is a non-persisted forecast projection. */
  virtual: z.boolean().default(false),
});

export type FeedItem = z.infer<typeof FeedItemBaseSchema> & {
  /** Nested member rows for a GROUP row; empty for leaf rows. */
  children: FeedItem[];
};

export const FeedItemSchema: z.ZodType<FeedItem> = FeedItemBaseSchema.extend({
  children: z.lazy(() => z.array(FeedItemSchema)).default([]),
});

export const FeedViewSchema = z.object({
  items: z.array(FeedItemSchema),
  includesForecast: z.boolean(),
});

export type FeedView = z.infer<typeof FeedViewSchema>;
