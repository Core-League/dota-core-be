import { Injectable, Logger } from '@nestjs/common';
import { MonobankService } from '../../connectors/monobank/monobank.service';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { TransactionRepository } from '../../repos/transaction.repository';
import { ClassificationService } from '../classification/classification.service';
import { toStoredTransaction } from '../shared/bank-transaction.mapper';
import { isWatchedAccount } from '../shared/watched-accounts';

export interface SyncPeriodResult {
  /** Transactions newly stored. Always 0 for an unwatched account/jar. */
  synced: number;
}

/**
 * Backfill / reconciliation. Pulls a statement window from Bank, then inserts and
 * classifies only the not-yet-stored transactions; existing ones (and their
 * operations + manual edits) are left untouched, so a re-sync never overrides them.
 *
 * Storage + classification are limited to watched accounts exactly as on the push
 * path ({@link IngestionService}), so backfilling an unrelated jar on the same
 * token does not copy its whole statement into the finance tables.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly bank: MonobankService,
    private readonly transactionRepo: TransactionRepository,
    private readonly classificationService: ClassificationService,
    private readonly config: ConfigConnectorService,
  ) {}

  async syncPeriod(
    accountId: string,
    from: Date,
    to?: Date,
  ): Promise<SyncPeriodResult> {
    const fetched = (await this.bank.getStatement(accountId, from, to)).map(
      (tx) => toStoredTransaction(accountId, tx),
    );
    const watched = isWatchedAccount(accountId, this.config.getEnvConfig());

    let synced = 0;
    if (watched) {
      const existingIds = new Set(
        await this.transactionRepo.findExistingIds(fetched.map((t) => t.id)),
      );
      const newTransactions = fetched.filter((t) => !existingIds.has(t.id));

      for (const tx of newTransactions) {
        await this.transactionRepo.upsert(tx);
      }
      await this.classificationService.classifyNew(newTransactions);
      synced = newTransactions.length;
    }

    this.logger.log(
      `Synced account ${accountId} (${fetched.length} fetched, ` +
        `${synced} newly stored${watched ? '' : ' — unwatched: storage/classification skipped'})`,
    );
    return { synced };
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
