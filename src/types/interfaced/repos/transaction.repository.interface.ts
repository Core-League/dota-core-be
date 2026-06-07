import type { StoredTransaction } from '../../entities/finance/transaction';

export interface ITransactionRepository {
  upsert(tx: StoredTransaction): Promise<StoredTransaction>;
  findExistingIds(ids: string[]): Promise<string[]>;
  findById(id: string): Promise<StoredTransaction | null>;
  findAll(): Promise<StoredTransaction[]>;
  findByAccount(accountId: string): Promise<StoredTransaction[]>;
}
