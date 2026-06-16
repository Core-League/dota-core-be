import { z } from 'zod';
import { StorageType } from '../../enums/finance/StorageType';
import { AssetType } from '../../enums/finance/AssetType';

/**
 * A managed image asset (icon / logo) stored in our DB. Custom operations,
 * groups, and categories reference one via an `iconAssetId` foreign key.
 *
 * Storage-agnostic: we persist only `storageType` + `path` (the key/relative
 * path within that backend). The public URL is **computed dynamically** at read
 * time (see `AssetService.resolveUrl`), never stored — so switching storage
 * doesn't require a data migration.
 */
export const AssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(AssetType),
  storageType: z.enum(StorageType),
  path: z.string(),
});

export type Asset = z.infer<typeof AssetSchema>;

/** Client-facing asset with the resolved public `url`. */
export const AssetViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
});

export type AssetView = z.infer<typeof AssetViewSchema>;
