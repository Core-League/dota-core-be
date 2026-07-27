import { Injectable, Logger } from '@nestjs/common';
import { MonobankService } from '../../connectors/monobank/monobank.service';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { TransactionRepository } from '../../repos/transaction.repository';
import { TournamentPaymentRepository } from '../../repos/tournament-payment.repository';
import { ClassificationService } from '../classification/classification.service';
import { toStoredTransaction } from '../shared/bank-transaction.mapper';
import { isWatchedAccount } from '../shared/watched-accounts';

export interface SyncPeriodResult {
  /** Transactions newly stored. Always 0 for an unwatched account/jar. */
  synced: number;
  /** Entry-fee payments this run moved to PAID/UNDERPAID. */
  reconciled: number;
}

/**
 * Backfill / reconciliation. Pulls a statement window from Bank, then inserts and
 * classifies only the not-yet-stored transactions; existing ones (and their
 * operations + manual edits) are left untouched, so a re-sync never overrides them.
 *
 * Storage and reconciliation are split by account exactly as on the push path
 * ({@link IngestionService}):
 *
 * - **Reconciliation runs for every fetched transaction**, watched or not, because
 *   `CORE-…` references are globally unique and match nothing outside this app.
 *   This is what lets a jar backfill recover entry fees that landed before the
 *   webhook existed.
 * - **Storage + classification are limited to watched accounts.** Without that
 *   split, backfilling a tournament jar to recover its payments would also copy
 *   that jar's whole statement into the finance tables — the very pollution the
 *   push path takes care to avoid.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly bank: MonobankService,
    private readonly transactionRepo: TransactionRepository,
    private readonly classificationService: ClassificationService,
    private readonly tournamentPaymentRepo: TournamentPaymentRepository,
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

    // Reconcile the whole fetched window, not just the new rows: a transfer can
    // land before the captain creates the payment record, and that reference
    // would then never be matched by any later sync. Re-matching costs nothing —
    // the UPDATE skips rows that are already PAID.
    const reconciled =
      await this.tournamentPaymentRepo.reconcileTransactions(fetched);

    this.logger.log(
      `Synced account ${accountId} (${fetched.length} fetched, ` +
        `${synced} newly stored${watched ? '' : ' — unwatched: storage/classification skipped'}, ` +
        `${reconciled.length} payment(s) reconciled)`,
    );
    return { synced, reconciled: reconciled.length };
  }

  /**
   * Re-run classification over every stored transaction to refresh group/category
   * assignments after sponsors or teams change. Preserves manual overrides
   * (see {@link ClassificationService.reclassifyAll}).
   */
  async reclassifyAll(): Promise<number> {
    const count = await this.classificationService.reclassifyAll();
    // Backfill/repair tournament payments from all stored transactions.
    const allTransactions = await this.transactionRepo.findAll();
    await this.tournamentPaymentRepo.reconcileTransactions(allTransactions);
    this.logger.log(`Reclassified ${count} operations`);
    return count;
  }
}
