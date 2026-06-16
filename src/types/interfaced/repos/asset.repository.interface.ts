import type { Asset } from '../../entities/finance/asset';
import type { StorageType } from '../../enums/finance/StorageType';

export interface IAssetRepository {
  findAll(): Promise<Asset[]>;
  findById(id: string): Promise<Asset | null>;
  create(asset: Omit<Asset, 'id'>): Promise<Asset>;
  createMany(assets: Asset[]): Promise<Asset[]>;
  deleteByIds(ids: string[]): Promise<void>;
  upsertByLocation(input: {
    storageType: StorageType;
    path: string;
    name: string;
  }): Promise<Asset>;
  upsertManyByLocation(inputs: Omit<Asset, 'id'>[]): Promise<Asset[]>;
}
