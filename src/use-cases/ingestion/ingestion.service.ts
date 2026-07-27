import { Injectable, Logger } from '@nestjs/common';
import { MonobankService } from '../../connectors/monobank/monobank.service';
import { TransactionRepository } from '../../repos/transaction.repository';
import { TournamentPaymentRepository } from '../../repos/tournament-payment.repository';
import { ClassificationService } from '../classification/classification.service';
import { toStoredTransaction } from '../shared/bank-transaction.mapper';
import { isWatchedAccount } from '../shared/watched-accounts';
import { ConfigConnectorService } from 'src/connectors/config/config-connector.service';

/**
 * Webhook entry point. Validates the push, persists the raw transaction
 * (de-duped by id), and classifies it into an operation. Idempotent: a repeated
 * push for the same transaction upserts rather than duplicating.
 *
 * One webhook URL covers every account and jar on the token, so pushes arrive for
 * things this app does not track. Handling is split by concern rather than by a
 * single allow-list:
 *
 * - **Reconciliation runs for every push.** It matches globally-unique `CORE-…`
 *   references, so an unrelated transaction matches zero rows. This is what lets
 *   entry fees land in a new per-tournament jar with no configuration — requiring
 *   an id per jar up front would mean a lookup and a redeploy per tournament.
 * - **Storage** is limited to watched accounts plus anything that reconciled, so a
 *   personal card on the same token does not have its statement copied here.
 * - **Classification** (finance operations/balance) stays limited to watched
 *   accounts, so jar traffic cannot pollute those views.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly bank: MonobankService,
    private readonly transactionRepo: TransactionRepository,
    private readonly classificationService: ClassificationService,
    private readonly tournamentPaymentRepo: TournamentPaymentRepository,
    private readonly configConnector: ConfigConnectorService,
  ) {}

  async handleWebhook(rawBody: unknown): Promise<void> {
    try {
      const payload = this.bank.parseWebhookPayload(rawBody);
      const envConfig = this.configConnector.getEnvConfig();
      const { account, statementItem } = payload.data;

      const stored = toStoredTransaction(account, statementItem);
      const watched = isWatchedAccount(account, envConfig);

      // Always attempted: reference matching is account-agnostic, so this is what
      // makes a brand-new tournament jar work with no config change.
      const reconciled = await this.tournamentPaymentRepo.reconcileTransactions(
        [stored],
      );

      if (!watched && reconciled.length === 0) {
        this.logger.debug(
          `Skipping unwatched account/jar ${account} (no entry-fee reference matched)`,
        );
        return;
      }

      await this.transactionRepo.upsert(stored);
      if (watched) {
        await this.classificationService.classify(stored);
      }
      this.logger.log(
        `Ingested transaction ${stored.id} on account ${account}` +
          (reconciled.length > 0
            ? ` — reconciled ${reconciled.map((r) => r.reference).join(', ')}`
            : ''),
      );
    } catch (err) {
      this.logger.error('Failed to handle webhook push', err);
    }
  }
}
