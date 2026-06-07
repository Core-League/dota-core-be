import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  toOperationGroup,
  toOperationGroupWithAttachment,
} from '../db/mappers/operation-group.mapper';
import { OperationGroupModel } from '../db/models/operation-group.model';
import type {
  OperationGroup,
  OperationGroupWithAttachment,
} from '../types/entities/finance/operation-group';
import type { IOperationGroupRepository } from '../types/interfaced/repos/operation-group.repository.interface';

/** Persistence for operation groups (prize / sponsor / custom). */
@Injectable()
export class OperationGroupRepository implements IOperationGroupRepository {
  constructor(
    @InjectRepository(OperationGroupModel)
    private readonly repo: Repository<OperationGroupModel>,
  ) {}

  async findAll(): Promise<OperationGroup[]> {
    const models = await this.repo.find({ relations: { operations: true } });
    return models.map(toOperationGroup);
  }

  async findById(id: string): Promise<OperationGroup | null> {
    const model = await this.repo.findOne({
      where: { id },
      relations: { operations: true },
    });
    return model ? toOperationGroup(model) : null;
  }

  /** Upsert an automatic group (PRIZE / SPONSOR) by its (kind, `groupKey`). */
  async upsertByGroupKey(
    data: Omit<OperationGroup, 'id' | 'operationIds'>,
  ): Promise<OperationGroup> {
    const existing = await this.repo.findOne({
      where: { groupKey: data.groupKey, kind: data.kind },
    });
    const model = this.repo.create({
      ...(existing ? { id: existing.id } : {}),
      kind: data.kind,
      title: data.title,
      iconAssetId: data.iconAssetId,
      groupKey: data.groupKey,
    });
    const saved = await this.repo.save(model);
    return toOperationGroup(saved);
  }

  /** Create a CUSTOM (manually assembled) group. */
  async create(
    data: Omit<OperationGroup, 'id' | 'operationIds'>,
  ): Promise<OperationGroupWithAttachment> {
    const saved = await this.repo.save(
      this.repo.create({
        kind: data.kind,
        title: data.title,
        iconAssetId: data.iconAssetId,
        groupKey: data.groupKey,
      }),
    );
    const model = await this.repo.findOneOrFail({
      where: { id: saved.id },
      relations: { iconAsset: true },
    });
    return toOperationGroupWithAttachment(model);
  }
}
