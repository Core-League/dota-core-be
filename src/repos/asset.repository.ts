import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toAsset } from '../db/mappers/asset.mapper';
import { AssetModel } from '../db/models/asset.model';
import type { Asset } from '../types/entities/finance/asset';
import { StorageType } from '../types/enums/finance/StorageType';
import type { IAssetRepository } from '../types/interfaced/repos/asset.repository.interface';

/** Persistence + lookup for managed image assets. */
@Injectable()
export class AssetRepository implements IAssetRepository {
  constructor(
    @InjectRepository(AssetModel)
    private readonly repo: Repository<AssetModel>,
  ) {}

  async findAll(): Promise<Asset[]> {
    const models = await this.repo.find();
    return models.map(toAsset);
  }

  async findById(id: string): Promise<Asset | null> {
    const model = await this.repo.findOne({ where: { id } });
    return model ? toAsset(model) : null;
  }

  async create(asset: Omit<Asset, 'id'>): Promise<Asset> {
    const saved = await this.repo.save(this.repo.create(asset));
    return toAsset(saved);
  }

  /**
   * Return the asset at `(storageType, path)`, creating it if absent. Used to
   * give foreign images (e.g. a v1 team avatar URL) a stable asset row without
   * duplicating one per classification pass.
   */
  async upsertByLocation(input: {
    storageType: StorageType;
    path: string;
    name: string;
  }): Promise<Asset> {
    const existing = await this.repo.findOne({
      where: { storageType: input.storageType, path: input.path },
    });
    if (existing) return toAsset(existing);
    return this.create(input);
  }
}
