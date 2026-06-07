import { z } from 'zod';
import { OperationType } from '../../enums/finance/OperationType';

/**
 * A classified operation for display, derived from a {@link StoredTransaction}
 * (or manual — then `transactionId` is null). Amount is signed **kopecks**;
 * `groupId` links it to an {@link OperationGroup}.
 */
export const OperationSchema = z.object({
  id: z.string(),
  transactionId: z.string().nullable(),
  type: z.enum(OperationType),
  amount: z.number().int(),
  time: z.date(),
  title: z.string(),
  /** FK to the icon asset (sponsor logo, team avatar, or user-chosen). */
  iconAssetId: z.string().nullable(),
  groupId: z.string().nullable(),
  comment: z.string().nullable(),
  /** FK to the assigned category (single per operation), or null. */
  categoryId: z.string().nullable(),
  /** True once a user assigned the category by hand; locks it against auto-match. */
  categoryManual: z.boolean().default(false),
  /** Hidden from the feed unless explicitly requested (`showHidden`). */
  isHidden: z.boolean().default(false),
  /** Snapshot of the originating raw fields, kept for audit. */
  raw: z.record(z.string(), z.unknown()).nullable(),
});

export type Operation = z.infer<typeof OperationSchema>;

/** An operation not yet persisted (no generated `id`). */
export type OperationDraft = Omit<Operation, 'id'>;

/** A row to persist: insert when `id` is absent, update in place when present. */
export type OperationUpsert = OperationDraft & { id?: string };
