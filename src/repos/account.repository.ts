import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toAccountModel, toStoredAccount } from '../db/mappers/account.mapper';
import { AccountModel } from '../db/models/account.model';
import type { StoredAccount } from '../types/entities/finance/account';
import type { IAccountRepository } from '../types/interfaced/repos/account.repository.interface';

/** Persistence for the local mirror of Bank accounts. */
@Injectable()
export class AccountRepository implements IAccountRepository {
  constructor(
    @InjectRepository(AccountModel)
    private readonly repo: Repository<AccountModel>,
  ) {}

  async upsert(account: StoredAccount): Promise<StoredAccount> {
    await this.repo.upsert(toAccountModel(account), ['id']);
    return account;
  }

  async findById(id: string): Promise<StoredAccount | null> {
    const model = await this.repo.findOne({ where: { id } });
    return model ? toStoredAccount(model) : null;
  }
}
