import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { toCustomCategoryView } from '../../db/mappers/custom-category.mapper';
import { toOperationGroupView } from '../../db/mappers/operation-group.mapper';
import { CustomCategoryRepository } from '../../repos/custom-category.repository';
import { OperationGroupRepository } from '../../repos/operation-group.repository';
import { OperationRepository } from '../../repos/operation.repository';
import type { CustomCategoryView } from '../../types/entities/finance/custom-category';
import type { OperationGroupView } from '../../types/entities/finance/operation-group';
import { OperationGroupKind } from '../../types/enums/finance/OperationGroupKind';
import { AssetService } from '../asset/asset.service';

/**
 * Manual edits to the feed: relabel an operation, set its icon, group operations
 * by hand, and save reusable custom categories. Icon selection stores an
 * `iconAssetId` FK into the asset catalog; the feed resolves it to a URL.
 */
@Injectable()
export class CustomOperationService {
  constructor(
    private readonly operationRepo: OperationRepository,
    private readonly groupRepo: OperationGroupRepository,
    private readonly categoryRepo: CustomCategoryRepository,
    private readonly assetService: AssetService,
    private readonly config: ConfigConnectorService,
  ) {}

  async rename(operationId: string, label: string): Promise<void> {
    await this.requireOperation(operationId);
    await this.operationRepo.update(operationId, { title: label });
  }

  async setIcon(operationId: string, iconAssetId: string): Promise<void> {
    await this.requireOperation(operationId);
    await this.requireAsset(iconAssetId);
    await this.operationRepo.update(operationId, { iconAssetId });
  }

  /** Manually collapse the given operations into one CUSTOM group. */
  async groupOperations(
    operationIds: string[],
    title: string,
    iconAssetId?: string,
  ): Promise<OperationGroupView> {
    const operations = await this.operationRepo.findManyByIds(operationIds);
    if (operations.length !== operationIds.length) {
      throw new NotFoundException('One or more operations were not found');
    }
    if (iconAssetId) await this.requireAsset(iconAssetId);
    const aggregatedAmount = operations.reduce((sum, op) => sum + op.amount, 0);
    const group = await this.groupRepo.create({
      kind: OperationGroupKind.Custom,
      title,
      iconAssetId: iconAssetId ?? null,
      aggregatedAmount,
      groupKey: `custom:${Date.now()}`,
    });
    for (const op of operations) {
      await this.operationRepo.setGroup(op.id, group.id);
    }
    // Patch operationIds — the repo creates without the operations relation loaded
    const fullGroup = { ...group, operationIds: operations.map((op) => op.id) };
    return toOperationGroupView(fullGroup, this.baseUrl());
  }

  async createCategory(
    label: string,
    iconAssetId: string | null,
  ): Promise<CustomCategoryView> {
    if (iconAssetId) await this.requireAsset(iconAssetId);
    const category = await this.categoryRepo.create({ label, iconAssetId });
    return toCustomCategoryView(category, this.baseUrl());
  }

  private async requireOperation(operationId: string): Promise<void> {
    const operation = await this.operationRepo.findById(operationId);
    if (!operation) {
      throw new NotFoundException(`Operation ${operationId} not found`);
    }
  }

  private async requireAsset(assetId: string): Promise<void> {
    const asset = await this.assetService.findById(assetId);
    if (!asset) {
      throw new NotFoundException(`Asset ${assetId} not found`);
    }
  }

  private baseUrl(): string {
    return (this.config.getEnvConfig().API_BASE_URL ?? '').replace(/\/+$/, '');
  }
}
