import { Injectable, Logger } from '@nestjs/common';
import { MonobankService } from '../../connectors/monobank/monobank.service';
import { TransactionRepository } from '../../repos/transaction.repository';
import { ClassificationService } from '../classification/classification.service';
import { toStoredTransaction } from '../shared/bank-transaction.mapper';

/**
 * Webhook entry point. Validates the push, persists the raw transaction
 * (de-duped by id), and classifies it into an operation. Idempotent: a repeated
 * push for the same transaction upserts rather than duplicating.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly bank: MonobankService,
    private readonly transactionRepo: TransactionRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  async handleWebhook(rawBody: unknown): Promise<void> {
    try {
      const payload = this.bank.parseWebhookPayload(rawBody);
      const { account, statementItem } = payload.data;
      const stored = toStoredTransaction(account, statementItem);
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
