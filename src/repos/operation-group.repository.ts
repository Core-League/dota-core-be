import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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

  async findAllWithAttachment(): Promise<OperationGroupWithAttachment[]> {
    const models = await this.repo.find({
      relations: { iconAsset: true, operations: true },
    });
    return models.map(toOperationGroupWithAttachment);
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

  /**
   * Bulk variant of {@link upsertByGroupKey}: upsert many automatic groups by
   * their (`kind`, `groupKey`) in one read + one chunked save. Returns one group
   * per input spec, in input order (specs sharing a key collapse to one row).
   */
  async upsertManyByGroupKey(
    specs: Omit<OperationGroup, 'id' | 'operationIds'>[],
  ): Promise<OperationGroup[]> {
    if (specs.length === 0) return [];
    const key = (s: { kind: OperationGroup['kind']; groupKey: string }) =>
      `${s.kind} ${s.groupKey}`;

    const existing = await this.repo.find({
      where: { groupKey: In(specs.map((s) => s.groupKey)) },
    });
    const idByKey = new Map(existing.map((e) => [key(e), e.id]));

    const distinct = new Map<
      string,
      Omit<OperationGroup, 'id' | 'operationIds'>
    >();
    for (const spec of specs) distinct.set(key(spec), spec);

    const models = [...distinct].map(([k, spec]) =>
      this.repo.create({
        ...(idByKey.has(k) ? { id: idByKey.get(k) } : {}),
        kind: spec.kind,
        title: spec.title,
        iconAssetId: spec.iconAssetId,
        groupKey: spec.groupKey,
      }),
    );
    const saved = await this.repo.save(models, { chunk: 200 });
    const groupByKey = new Map(saved.map((m) => [key(m), toOperationGroup(m)]));
    return specs.map((spec) => groupByKey.get(key(spec))!);
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

  /** Update a group's editable fields, returning it with icon + members loaded. */
  async update(
    id: string,
    patch: Partial<Pick<OperationGroup, 'title' | 'iconAssetId'>>,
  ): Promise<OperationGroupWithAttachment> {
    await this.repo.update({ id }, patch);
    const model = await this.repo.findOneOrFail({
      where: { id },
      relations: { iconAsset: true, operations: true },
    });
    return toOperationGroupWithAttachment(model);
  }

  /** Delete a group; member operations are ungrouped via the FK (SET NULL). */
  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}
