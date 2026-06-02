import type { Transaction as BankTransaction } from '../../types/entities/bank';
import type { StoredTransaction } from '../../types/entities/finance/transaction';

/**
 * Map a Bank API transaction (statement item / webhook payload) onto the
 * persisted {@link StoredTransaction}. `time` is Unix seconds in the API → `Date`;
 * the bank's optional string fields become `undefined` when absent.
 */
export function toStoredTransaction(
  accountId: string,
  tx: BankTransaction,
): StoredTransaction {
  return {
    id: tx.id,
    accountId,
    time: new Date(tx.time * 1000),
    amount: tx.amount,
    description: tx.description,
    comment: tx.comment,
    mcc: tx.mcc,
    counterIban: tx.counterIban,
    counterEdrpou: tx.counterEdrpou,
    balance: tx.balance,
    hold: tx.hold,
    currencyCode: tx.currencyCode,
  };
}
