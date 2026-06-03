import type { StoredAccount } from '../../types/entities/finance/account';
import { AccountModel } from '../models/account.model';

/** TypeORM `AccountModel` ↔ domain `StoredAccount`. */
export function toStoredAccount(model: AccountModel): StoredAccount {
  return {
    id: model.id,
    maskedPan: model.maskedPan ?? [],
    balance: model.balance,
    currencyCode: model.currencyCode,
    type: model.type,
  };
}

export function toAccountModel(entity: StoredAccount): AccountModel {
  const model = new AccountModel();
  model.id = entity.id;
  model.maskedPan = entity.maskedPan;
  model.balance = entity.balance;
  model.currencyCode = entity.currencyCode;
  model.type = entity.type;
  return model;
}
