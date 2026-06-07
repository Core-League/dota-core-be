import { Injectable } from '@nestjs/common';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { resolveAssetUrl, toAssetView } from '../../db/mappers/asset.mapper';
import { AssetRepository } from '../../repos/asset.repository';
import type { Asset, AssetView } from '../../types/entities/finance/asset';
import { StorageType } from '../../types/enums/finance/StorageType';

/**
 * Asset catalog. Persists only `storageType` + `path`; the public URL is derived
 * by the mapper at read time (see `resolveAssetUrl`), so moving an asset (or the
 * whole catalog) to another backend is a resolver change, not a data migration.
 * This service just supplies the app's base URL to the mapper.
 */
@Injectable()
export class AssetService {
  constructor(
    private readonly assetRepo: AssetRepository,
    private readonly config: ConfigConnectorService,
  ) { }

  async list(): Promise<AssetView[]> {
    const baseUrl = this.baseUrl();
    const assets = await this.assetRepo.findAll();
    return assets.map((asset) => toAssetView(asset, baseUrl));
  }

  async create(input: Omit<Asset, 'id'>): Promise<AssetView> {
    const asset = await this.assetRepo.create(input);
    return toAssetView(asset, this.baseUrl());
  }

  /** Stored asset (no URL) — used to validate an `iconAssetId` reference. */
  findById(id: string): Promise<Asset | null> {
    return this.assetRepo.findById(id);
  }

  /**
   * Get (or lazily create) the asset that wraps a foreign absolute URL — e.g. a
   * v1 team avatar — so it can be referenced by `iconAssetId` like any other.
   */
  getOrCreateExternal(url: string, name: string): Promise<Asset> {
    return this.assetRepo.upsertByLocation({
      storageType: StorageType.ExternalUrl,
      path: url,
      name,
    });
  }

  /** Map of `assetId → resolved url`, for batch icon resolution in the feed. */
  async resolveUrlMap(): Promise<Map<string, string>> {
    const baseUrl = this.baseUrl();
    const assets = await this.assetRepo.findAll();
    return new Map(
      assets.map((asset) => [asset.id, resolveAssetUrl(asset, baseUrl)]),
    );
  }

  private baseUrl(): string {
    return (this.config.getEnvConfig().API_BASE_URL ?? '').replace(/\/+$/, '');
  }
}
