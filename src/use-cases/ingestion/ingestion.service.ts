import { Injectable, Logger } from '@nestjs/common';
import { MonobankService } from '../../connectors/monobank/monobank.service';
import { TransactionRepository } from '../../repos/transaction.repository';
import { TournamentPaymentRepository } from '../../repos/tournament-payment.repository';
import { ClassificationService } from '../classification/classification.service';
import { toStoredTransaction } from '../shared/bank-transaction.mapper';
import { ConfigConnectorService } from 'src/connectors/config/config-connector.service';
import type { Env } from '../../types/entities/env';

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
      const watched = this.isWatchedAccount(account, envConfig);

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

  /**
   * Whether a push belongs to an account/jar whose full traffic we store and
   * classify: the primary `MONOBANK_ACCOUNT_ID` plus every id in
   * `MONOBANK_ACCOUNT_IDS`. Entry-fee reconciliation does NOT depend on this —
   * listing a jar here only adds finance-side visibility for its non-payment
   * transactions.
   */
  private isWatchedAccount(account: string, envConfig: Env): boolean {
    if (account === envConfig.MONOBANK_ACCOUNT_ID) return true;
    return envConfig.MONOBANK_ACCOUNT_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(account);
  }
}
