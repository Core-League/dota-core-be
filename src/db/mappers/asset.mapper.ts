import type { Asset, AssetView } from '../../types/entities/finance/asset';
import { StorageType } from '../../types/enums/finance/StorageType';
import { AssetModel } from '../models/asset.model';

/** TypeORM `AssetModel` → domain `Asset` (storage fields only; URL is derived). */
export function toAsset(model: AssetModel): Asset {
  return {
    id: model.id,
    name: model.name,
    storageType: model.storageType,
    path: model.path,
  };
}

/**
 * Derive an asset's public URL from its `storageType` + `path`. `baseUrl` is the
 * app origin, used for `LOCAL` assets; `EXTERNAL_URL` assets carry an absolute
 * URL in `path` and are returned as-is. URLs are never stored — switching
 * backends is a new case here, not a data migration.
 */
export function resolveAssetUrl(asset: Asset, baseUrl: string): string {
  switch (asset.storageType) {
    case StorageType.ExternalUrl:
      return asset.path;
    case StorageType.Local:
    default:
      return baseUrl + asset.path;
  }
}

/** Domain `Asset` → client-facing `AssetView` with the resolved URL. */
export function toAssetView(asset: Asset, baseUrl: string): AssetView {
  return {
    id: asset.id,
    name: asset.name,
    url: resolveAssetUrl(asset, baseUrl),
  };
}
