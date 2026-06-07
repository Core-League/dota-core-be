import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { toOperation } from '../db/mappers/operation.mapper';
import { OperationModel } from '../db/models/operation.model';
import type {
  Operation,
  OperationDraft,
  OperationUpsert,
} from '../types/entities/finance/operation';
import type {
  IOperationRepository,
  OperationListFilter,
} from '../types/interfaced/repos/operation.repository.interface';

export type { OperationListFilter };

/**
 * Persistence for classified operations. The classification use-case owns the
 * idempotency/preserve rules; this repository only offers the primitives it needs
 * — load the existing rows for a set of transactions, then write a batch.
 */
@Injectable()
export class OperationRepository implements IOperationRepository {
  constructor(
    @InjectRepository(OperationModel)
    private readonly repo: Repository<OperationModel>,
  ) {}

  /** Load the operations derived from the given transactions in one query. */
  async findByTransactionIds(txIds: string[]): Promise<Operation[]> {
    if (txIds.length === 0) return [];
    const models = await this.repo.find({
      where: { transactionId: In(txIds) },
    });
    return models.map(toOperation);
  }

  /**
   * Persist a batch of operations: rows with an `id` are updated in place, rows
   * without one are inserted. Written in a single chunked `save`.
   */
  async saveMany(rows: OperationUpsert[]): Promise<Operation[]> {
    if (rows.length === 0) return [];
    const models = rows.map((row) => this.repo.create(row));
    const saved = await this.repo.save(models, { chunk: 200 });
    return saved.map(toOperation);
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
    if (!filter.showHidden) qb.andWhere('op.isHidden = false');
    const models = await qb.getMany();
    return models.map(toOperation);
  }

  async setGroup(operationId: string, groupId: string | null): Promise<void> {
    await this.repo.update({ id: operationId }, { groupId });
  }

  async update(
    operationId: string,
    patch: Partial<
      Pick<
        Operation,
        | 'title'
        | 'iconAssetId'
        | 'categoryId'
        | 'categoryManual'
        | 'comment'
        | 'isHidden'
      >
    >,
  ): Promise<void> {
    await this.repo.update({ id: operationId }, patch);
  }

  async deleteByTransactionId(transactionId: string): Promise<void> {
    await this.repo.delete({ transactionId });
  }
}
