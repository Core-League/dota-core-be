import { Injectable, Logger } from '@nestjs/common';
import { MonobankService } from '../../connectors/monobank/monobank.service';
import { TransactionRepository } from '../../repos/transaction.repository';
import { ClassificationService } from '../classification/classification.service';
import { toStoredTransaction } from '../shared/bank-transaction.mapper';

/**
 * Backfill / reconciliation. Pulls a statement window from Bank, then inserts and
 * classifies only the not-yet-stored transactions; existing ones (and their
 * operations + manual edits) are left untouched, so a re-sync never overrides them.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly bank: MonobankService,
    private readonly transactionRepo: TransactionRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  async syncPeriod(accountId: string, from: Date, to?: Date): Promise<number> {
    const fetched = (await this.bank.getStatement(accountId, from, to)).map(
      (tx) => toStoredTransaction(accountId, tx),
    );
    const existingIds = new Set(
      await this.transactionRepo.findExistingIds(fetched.map((t) => t.id)),
    );
    const newTransactions = fetched.filter((t) => !existingIds.has(t.id));

    for (const tx of newTransactions) {
      await this.transactionRepo.upsert(tx);
    }
    await this.classificationService.classifyNew(newTransactions);

    this.logger.log(
      `Synced ${newTransactions.length} new transactions for account ${accountId} (${fetched.length} fetched)`,
    );
    return newTransactions.length;
  }

  /**
   * Re-run classification over every stored transaction to refresh group/category
   * assignments after sponsors or teams change. Preserves manual overrides
   * (see {@link ClassificationService.reclassifyAll}).
   */
  async reclassifyAll(): Promise<number> {
    const count = await this.classificationService.reclassifyAll();
    this.logger.log(`Reclassified ${count} operations`);
    return count;
  }
}
