import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { toOperation } from '../db/mappers/operation.mapper';
import { OperationModel } from '../db/models/operation.model';
import type {
  Operation,
  OperationDraft,
} from '../types/entities/finance/operation';
import type {
  IOperationRepository,
  OperationListFilter,
} from '../types/interfaced/repos/operation.repository.interface';

export type { OperationListFilter };

/**
 * Persistence for classified operations. `upsertByTransactionId` makes
 * classification idempotent: re-classifying a transaction overwrites its single
 * derived operation rather than appending a new one. Manual operations
 * (`transactionId === null`) are always inserted.
 */
@Injectable()
export class OperationRepository implements IOperationRepository {
  constructor(
    @InjectRepository(OperationModel)
    private readonly repo: Repository<OperationModel>,
  ) {}

  /**
   * Insert or replace the operation derived from a given transaction. Keeps the
   * existing row's `id` (and `groupId`) so references survive a re-classification.
   * Manual operations (`transactionId === null`) are always inserted.
   */
  async upsertByTransactionId(draft: OperationDraft): Promise<Operation> {
    let existingId: string | undefined;
    let existingGroupId: string | null = draft.groupId;
    if (draft.transactionId !== null) {
      const existing = await this.repo.findOne({
        where: { transactionId: draft.transactionId },
      });
      if (existing) {
        existingId = existing.id;
        existingGroupId = existing.groupId;
      }
    }
    const model = this.repo.create({
      ...(existingId ? { id: existingId } : {}),
      transactionId: draft.transactionId,
      type: draft.type,
      amount: draft.amount,
      time: draft.time,
      title: draft.title,
      iconAssetId: draft.iconAssetId,
      groupId: existingGroupId,
      comment: draft.comment,
      raw: draft.raw,
    });
    const saved = await this.repo.save(model);
    return toOperation(saved);
  }

  /** Insert a manual operation (no originating transaction). */
  async createManual(draft: OperationDraft): Promise<Operation> {
    const saved = await this.repo.save(this.repo.create(draft));
    return toOperation(saved);
  }

  async findById(id: string): Promise<Operation | null> {
    const model = await this.repo.findOne({ where: { id } });
    return model ? toOperation(model) : null;
  }

  async findManyByIds(ids: string[]): Promise<Operation[]> {
    if (ids.length === 0) return [];
    const models = await this.repo.find({ where: { id: In(ids) } });
    return models.map(toOperation);
  }

  async list(filter: OperationListFilter = {}): Promise<Operation[]> {
    const qb = this.repo.createQueryBuilder('op').orderBy('op.time', 'DESC');
    if (filter.from) qb.andWhere('op.time >= :from', { from: filter.from });
    if (filter.to) qb.andWhere('op.time <= :to', { to: filter.to });
    const models = await qb.getMany();
    return models.map(toOperation);
  }

  async setGroup(operationId: string, groupId: string | null): Promise<void> {
    await this.repo.update({ id: operationId }, { groupId });
  }

  async update(
    operationId: string,
    patch: Partial<Pick<Operation, 'title' | 'iconAssetId'>>,
  ): Promise<void> {
    await this.repo.update({ id: operationId }, patch);
  }

  async deleteByTransactionId(transactionId: string): Promise<void> {
    await this.repo.delete({ transactionId });
  }
}
