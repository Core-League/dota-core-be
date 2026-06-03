import type { StoredTransaction } from '../../types/entities/finance/transaction';
import { TransactionModel } from '../models/transaction.model';

/** TypeORM `TransactionModel` ↔ domain `StoredTransaction`. */
export function toStoredTransaction(
  model: TransactionModel,
): StoredTransaction {
  return {
    id: model.id,
    accountId: model.accountId,
    time: model.time,
    amount: model.amount,
    description: model.description,
    comment: model.comment ?? undefined,
    mcc: model.mcc,
    counterIban: model.counterIban ?? undefined,
    counterEdrpou: model.counterEdrpou ?? undefined,
    balance: model.balance,
    hold: model.hold,
    currencyCode: model.currencyCode,
  };
}

export function toTransactionModel(
  entity: StoredTransaction,
): TransactionModel {
  const model = new TransactionModel();
  model.id = entity.id;
  model.accountId = entity.accountId;
  model.time = entity.time;
  model.amount = entity.amount;
  model.description = entity.description;
  model.comment = entity.comment ?? null;
  model.mcc = entity.mcc;
  model.counterIban = entity.counterIban ?? null;
  model.counterEdrpou = entity.counterEdrpou ?? null;
  model.balance = entity.balance;
  model.hold = entity.hold;
  model.currencyCode = entity.currencyCode;
  return model;
}
