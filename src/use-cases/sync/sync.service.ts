import { Injectable, Logger } from '@nestjs/common';
import { MonobankService } from '../../connectors/monobank/monobank.service';
import { TransactionRepository } from '../../repos/transaction.repository';
import { ClassificationService } from '../classification/classification.service';
import { toStoredTransaction } from '../shared/bank-transaction.mapper';

/**
 * Backfill / reconciliation. Pulls a statement window from Bank (the client
 * already splits ≤31-day windows and de-dupes), upserts each transaction, then
 * runs a full reclassification pass over all stored transactions. The full pass
 * ensures every existing operation (not just the newly synced ones) has an
 * up-to-date PRIZE group assignment and `groupId`.
 * Returns the number of transactions pulled from the bank.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly bank: MonobankService,
    private readonly transactionRepo: TransactionRepository,
    private readonly classificationService: ClassificationService,
  ) { }

  async syncPeriod(accountId: string, from: Date, to?: Date): Promise<number> {
    const transactions = await this.bank.getStatement(accountId, from, to);
    for (const tx of transactions) {
      await this.transactionRepo.upsert(toStoredTransaction(accountId, tx));
    }
    await this.classificationService.reclassifyAll();
    this.logger.log(
      `Synced ${transactions.length} transactions for account ${accountId}`,
    );
    return transactions.length;
  }
}
