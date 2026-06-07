import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { toCustomCategoryView } from '../../db/mappers/custom-category.mapper';
import { toOperationGroupView } from '../../db/mappers/operation-group.mapper';
import { CustomCategoryRepository } from '../../repos/custom-category.repository';
import { OperationGroupRepository } from '../../repos/operation-group.repository';
import { OperationRepository } from '../../repos/operation.repository';
import type {
  CustomCategory,
  CustomCategoryView,
} from '../../types/entities/finance/custom-category';
import type {
  OperationGroup,
  OperationGroupView,
} from '../../types/entities/finance/operation-group';
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

  /**
   * Full update of an operation's editable fields. Setting the category by hand
   * locks it against auto-match (`categoryManual`), including when cleared to null.
   */
  async updateOperation(
    operationId: string,
    patch: {
      title: string;
      iconAssetId: string | null;
      categoryId: string | null;
      comment: string | null;
      isHidden: boolean;
    },
  ): Promise<void> {
    await this.requireOperation(operationId);
    if (patch.iconAssetId) await this.requireAsset(patch.iconAssetId);
    if (patch.categoryId) await this.requireCategory(patch.categoryId);
    await this.operationRepo.update(operationId, {
      title: patch.title,
      iconAssetId: patch.iconAssetId,
      categoryId: patch.categoryId,
      categoryManual: true,
      comment: patch.comment,
      isHidden: patch.isHidden,
    });
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
    const group = await this.groupRepo.create({
      kind: OperationGroupKind.Custom,
      title,
      iconAssetId: iconAssetId ?? null,
      groupKey: `custom:${Date.now()}`,
    });
    for (const op of operations) {
      await this.operationRepo.setGroup(op.id, group.id);
    }
    // Patch operationIds — the repo creates without the operations relation loaded
    const fullGroup = { ...group, operationIds: operations.map((op) => op.id) };
    return toOperationGroupView(fullGroup, this.baseUrl());
  }

  /**
   * Full update of a custom group: title, icon, and its membership. Operations
   * dropped from the set are ungrouped; the given operations become its members.
   */
  async updateGroup(
    groupId: string,
    patch: {
      title: string;
      iconAssetId: string | null;
      operationIds: string[];
    },
  ): Promise<OperationGroupView> {
    const group = await this.requireGroup(groupId);
    if (patch.iconAssetId) await this.requireAsset(patch.iconAssetId);

    const operations = await this.operationRepo.findManyByIds(
      patch.operationIds,
    );
    if (operations.length !== patch.operationIds.length) {
      throw new NotFoundException('One or more operations were not found');
    }

    // Reconcile membership: detach operations no longer listed, attach the rest.
    const nextIds = new Set(patch.operationIds);
    for (const oldId of group.operationIds) {
      if (!nextIds.has(oldId)) await this.operationRepo.setGroup(oldId, null);
    }
    for (const op of operations) {
      await this.operationRepo.setGroup(op.id, groupId);
    }

    const updated = await this.groupRepo.update(groupId, {
      title: patch.title,
      iconAssetId: patch.iconAssetId,
    });
    return toOperationGroupView(updated, this.baseUrl());
  }

  /** Delete a group; its member operations are ungrouped (FK SET NULL). */
  async deleteGroup(groupId: string): Promise<void> {
    await this.requireGroup(groupId);
    await this.groupRepo.delete(groupId);
  }

  async listCategories(): Promise<CustomCategoryView[]> {
    const baseUrl = this.baseUrl();
    const categories = await this.categoryRepo.findAllWithAttachment();
    return categories.map((c) => toCustomCategoryView(c, baseUrl));
  }

  async createCategory(
    data: Omit<CustomCategory, 'id'>,
  ): Promise<CustomCategoryView> {
    if (data.iconAssetId) await this.requireAsset(data.iconAssetId);
    const category = await this.categoryRepo.create(data);
    return toCustomCategoryView(category, this.baseUrl());
  }

  async updateCategory(
    id: string,
    patch: Partial<Omit<CustomCategory, 'id'>>,
  ): Promise<CustomCategoryView> {
    await this.requireCategory(id);
    if (patch.iconAssetId) await this.requireAsset(patch.iconAssetId);
    const category = await this.categoryRepo.update(id, patch);
    return toCustomCategoryView(category, this.baseUrl());
  }

  /** Delete a category; assigned operations keep `categoryId` → null (FK SET NULL). */
  async deleteCategory(id: string): Promise<void> {
    await this.requireCategory(id);
    await this.categoryRepo.delete(id);
  }

  private async requireOperation(operationId: string): Promise<void> {
    const operation = await this.operationRepo.findById(operationId);
    if (!operation) {
      throw new NotFoundException(`Operation ${operationId} not found`);
    }
  }

  private async requireGroup(groupId: string): Promise<OperationGroup> {
    const group = await this.groupRepo.findById(groupId);
    if (!group) {
      throw new NotFoundException(`Group ${groupId} not found`);
    }
    return group;
  }

  private async requireCategory(categoryId: string): Promise<void> {
    const category = await this.categoryRepo.findById(categoryId);
    if (!category) {
      throw new NotFoundException(`Category ${categoryId} not found`);
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
