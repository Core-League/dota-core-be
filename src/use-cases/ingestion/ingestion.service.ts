import { Injectable, Logger } from '@nestjs/common';
import { MonobankService } from '../../connectors/monobank/monobank.service';
import { TransactionRepository } from '../../repos/transaction.repository';
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
 * things this app does not track. Both storage and classification are limited to
 * watched accounts, so a personal card or jar on the same token does not have its
 * statement copied here.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly bank: MonobankService,
    private readonly transactionRepo: TransactionRepository,
    private readonly classificationService: ClassificationService,
    private readonly configConnector: ConfigConnectorService,
  ) {}

  async handleWebhook(rawBody: unknown): Promise<void> {
    try {
      const payload = this.bank.parseWebhookPayload(rawBody);
      const envConfig = this.configConnector.getEnvConfig();
      const { account, statementItem } = payload.data;

      const stored = toStoredTransaction(account, statementItem);
      const watched = isWatchedAccount(account, envConfig);
      if (!watched) {
        this.logger.debug(`Skipping unwatched account/jar ${account}`);
        return;
      }

      await this.transactionRepo.upsert(stored);
      await this.classificationService.classify(stored);
      this.logger.log(
        `Ingested transaction ${stored.id} on account ${account}`,
      );
    } catch (err) {
      this.logger.error('Failed to handle webhook push', err);
    }
  }
}
