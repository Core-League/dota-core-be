import type {
  ClientInfo,
  Transaction,
  WebhookPayload,
} from '../../entities/bank';

export interface IMonobankService {
  setWebhook(url: string): Promise<void>;
  getClientInfo(): Promise<ClientInfo>;
  getStatement(
    accountId: string,
    from: Date,
    to?: Date,
  ): Promise<Transaction[]>;
  parseWebhookPayload(raw: unknown): WebhookPayload;
}
