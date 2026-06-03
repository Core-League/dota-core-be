import type { StoredAccount } from '../../entities/finance/account';

export interface IAccountRepository {
  upsert(account: StoredAccount): Promise<StoredAccount>;
  findById(id: string): Promise<StoredAccount | null>;
}
