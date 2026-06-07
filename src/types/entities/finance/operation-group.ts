import { z } from 'zod';
import { OperationGroupKind } from '../../enums/finance/OperationGroupKind';
import { AssetSchema, AssetViewSchema } from './asset';

/**
 * A collapsed set of operations shown as one feed row. The single mechanism for
 * both automatic prize groups (`groupKey = team:<id>`) and manual custom groups
 * (`groupKey = custom:<timestamp>`). `operationIds` are its members; the
 * aggregated amount is calculated on the fly in the feed, not persisted.
 */
export const OperationGroupSchema = z.object({
  id: z.string(),
  kind: z.enum(OperationGroupKind),
  title: z.string(),
  /** FK to the icon asset (team avatar for PRIZE, user-chosen for CUSTOM). */
  iconAssetId: z.string().nullable(),
  operationIds: z.array(z.string()).default([]),
  groupKey: z.string(),
});

export type OperationGroup = z.infer<typeof OperationGroupSchema>;

export const OperationGroupWithAttachmentSchema = OperationGroupSchema.extend({
  iconAsset: AssetSchema.nullable(),
});

export type OperationGroupWithAttachment = z.infer<
  typeof OperationGroupWithAttachmentSchema
>;

export const OperationGroupViewSchema = OperationGroupSchema.omit({
  iconAssetId: true,
}).extend({
  icon: AssetViewSchema.nullable(),
});

export type OperationGroupView = z.infer<typeof OperationGroupViewSchema>;
