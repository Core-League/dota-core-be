import { Injectable } from '@nestjs/common';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { resolveAssetUrl, toAssetView } from '../../db/mappers/asset.mapper';
import { AssetRepository } from '../../repos/asset.repository';
import type { Asset, AssetView } from '../../types/entities/finance/asset';

/**
 * Asset catalog. Persists only `storageType` + `path`; the public URL is derived
 * at read time (see `resolveAssetUrl`), so switching backend is a resolver change,
 * not a data migration. This service just supplies the base URL to the mapper.
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

  /**
   * Bulk-create assets (e.g. one per uploaded proof); returns them in order.
   * Each input supplies its own `id` — for proofs, the image's `externalId`, so
   * the asset id matches the stored file name prefix.
   */
  createMany(inputs: Asset[]): Promise<Asset[]> {
    return this.assetRepo.createMany(inputs);
  }

  /** Permanently remove asset rows by id (used when their owner drops them). */
  deleteByIds(ids: string[]): Promise<void> {
    return this.assetRepo.deleteByIds(ids);
  }

  /** Resolve a batch of stored assets to client-facing views (with URLs). */
  toViews(assets: Asset[]): AssetView[] {
    const baseUrl = this.baseUrl();
    return assets.map((asset) => toAssetView(asset, baseUrl));
  }

  /**
   * Resolve many asset locations in one read + one insert, reusing existing rows.
   * Returns the raw assets (no URL) in input order.
   */
  ensureManyByLocation(inputs: Omit<Asset, 'id'>[]): Promise<Asset[]> {
    return this.assetRepo.upsertManyByLocation(inputs);
  }

  /** Stored asset (no URL) — used to validate an `iconAssetId` reference. */
  findById(id: string): Promise<Asset | null> {
    return this.assetRepo.findById(id);
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
