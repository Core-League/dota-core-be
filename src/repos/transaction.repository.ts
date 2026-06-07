import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  toStoredTransaction,
  toTransactionModel,
} from '../db/mappers/transaction.mapper';
import { TransactionModel } from '../db/models/transaction.model';
import type { StoredTransaction } from '../types/entities/finance/transaction';
import type { ITransactionRepository } from '../types/interfaced/repos/transaction.repository.interface';

/**
 * Persistence for raw bank transactions. `upsert` is keyed on the Bank
 * transaction id, so re-ingesting the same item (webhook + statement) is a no-op
 * dedupe rather than a duplicate row.
 */
@Injectable()
export class TransactionRepository implements ITransactionRepository {
  constructor(
    @InjectRepository(TransactionModel)
    private readonly repo: Repository<TransactionModel>,
  ) {}

  async upsert(tx: StoredTransaction): Promise<StoredTransaction> {
    const model = toTransactionModel(tx);
    await this.repo.upsert(model, ['id']);
    return tx;
  }

  /** Of the given bank ids, return those already stored — so sync can insert only the new ones. */
  async findExistingIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.repo.find({
      where: { id: In(ids) },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async findById(id: string): Promise<StoredTransaction | null> {
    const model = await this.repo.findOne({ where: { id } });
    return model ? toStoredTransaction(model) : null;
  }

  async findAll(): Promise<StoredTransaction[]> {
    const models = await this.repo.find({ order: { time: 'ASC' } });
    return models.map(toStoredTransaction);
  }

  async findByAccount(accountId: string): Promise<StoredTransaction[]> {
    const models = await this.repo.find({
      where: { accountId },
      order: { time: 'ASC' },
    });
    return models.map(toStoredTransaction);
  }
}
