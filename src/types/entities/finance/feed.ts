import { z } from 'zod';

/**
 * A row in the operations feed. The feed flattens three sources into one shape:
 * a standalone operation, a collapsed operation group, and (when forecast is on)
 * two virtual forecast rows. `sign` is derived from the amount and drives color
 * in presentation (`POSITIVE` = green, `NEGATIVE` = red); nothing about color is
 * persisted.
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

export const FeedItemSchema = z.object({
  kind: z.enum(FeedItemKind),
  id: z.string(),
  amount: z.number().int(),
  sign: z.enum(FeedItemSign),
  time: z.date().nullable(),
  title: z.string(),
  /** Resolved icon URL (from the referenced asset), or null. */
  iconUrl: z.string().nullable(),
  /** Member operation ids for a GROUP row; empty otherwise. */
  operationIds: z.array(z.string()).default([]),
  /** Whether this row is a non-persisted forecast projection. */
  virtual: z.boolean().default(false),
});

export type FeedItem = z.infer<typeof FeedItemSchema>;

export const FeedViewSchema = z.object({
  items: z.array(FeedItemSchema),
  includesForecast: z.boolean(),
});

export type FeedView = z.infer<typeof FeedViewSchema>;
