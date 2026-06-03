import { Injectable, Logger } from '@nestjs/common';
import type { AxiosRequestConfig } from 'axios';
import { z } from 'zod';
import { ConfigConnectorService } from '../config/config-connector.service';
import { HttpClientConnectorService } from '../http-client/http-client-connector.service';
import { HttpError } from '../../errors/http.error';
import { BankAuthError, BankRateLimitError } from '../../errors/bank.error';
import {
  ClientInfoSchema,
  TransactionSchema,
  WebhookPayloadSchema,
  type ClientInfo,
  type Transaction,
  type WebhookPayload,
} from '../../types/entities/bank';
import type { IMonobankService } from '../../types/interfaced/connectors/monobank.connector.interface';

/** Max span Monobank accepts for one statement request: 31 days + 1 hour. */
const MAX_STATEMENT_WINDOW_SEC = 2_682_000;

/** Backoff applied before the single retry on a 429. */
const RATE_LIMIT_BACKOFF_SEC = 60;

/**
 * Thin client over the Monobank Personal API (https://api.monobank.ua). It is
 * transport-only — it talks to the bank and returns typed data. Classifying
 * operations and the forecast calculator live in a separate business layer.
 *
 * All amounts stay in **kopecks**; converting to UAH is the consumer's job.
 *
 * Reliability: both `client-info` and `statement` are limited to one call per
 * 60s. A `429` surfaces as {@link BankRateLimitError} and is retried once
 * after a 60s backoff; a `403` surfaces as {@link BankAuthError}.
 */
@Injectable()
export class MonobankService implements IMonobankService {
  private readonly logger = new Logger(MonobankService.name);

  constructor(
    private readonly http: HttpClientConnectorService,
    private readonly config: ConfigConnectorService,
  ) {}

  /**
   * Register the URL Monobank pushes new transactions to.
   * `POST /personal/webhook` with `{ webHookUrl }`.
   *
   * After registration Monobank performs a test `GET` on this URL and only
   * activates the webhook if the receiver replies `200 OK`. That receiver is
   * out of this client's scope — see {@link parseWebhookPayload} for the body
   * it will get on each push.
   */
  async setWebhook(url: string): Promise<void> {
    await this.call(() =>
      this.http.post(
        '/personal/webhook',
        { webHookUrl: url },
        this.authConfig(),
      ),
    );
  }

  /**
   * `GET /personal/client-info` — source of accounts, card masks, balances and
   * the current `webHookUrl`. Needed to resolve an `accountId` for statements.
   */
  async getClientInfo(): Promise<ClientInfo> {
    return this.callWithRetry(async () => {
      const raw = await this.http.get<unknown>(
        '/personal/client-info',
        this.authConfig(),
      );
      return ClientInfoSchema.parse(raw);
    });
  }

  /**
   * `GET /personal/statement/{account}/{from}/{to}` (Unix seconds). Ranges
   * longer than {@link MAX_STATEMENT_WINDOW_SEC} are split into sequential
   * windows; results are concatenated and de-duped by `Transaction.id`.
   *
   * @param accountId account to read (resolve via {@link getClientInfo})
   * @param from inclusive start
   * @param to inclusive end; defaults to now when omitted
   */
  async getStatement(
    accountId: string,
    from: Date,
    to?: Date,
  ): Promise<Transaction[]> {
    const fromSec = Math.floor(from.getTime() / 1000);
    const toSec = to
      ? Math.floor(to.getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    if (fromSec > toSec) {
      throw new Error('getStatement: `from` must not be after `to`');
    }

    const byId = new Map<string, Transaction>();
    for (const [winFrom, winTo] of this.buildWindows(fromSec, toSec)) {
      const items = await this.callWithRetry(async () => {
        const raw = await this.http.get<unknown>(
          `/personal/statement/${accountId}/${winFrom}/${winTo}`,
          this.authConfig(),
        );
        return z.array(TransactionSchema).parse(raw);
      });
      for (const tx of items) {
        byId.set(tx.id, tx);
      }
    }
    return [...byId.values()];
  }

  /**
   * Validate a webhook push body (`{ type: "StatementItem", data: {...} }`).
   * Throws if `type` is not `"StatementItem"` or the shape is invalid, so a
   * future receiver can reuse this instead of duplicating the check.
   */
  parseWebhookPayload(raw: unknown): WebhookPayload {
    return WebhookPayloadSchema.parse(raw);
  }

  /** Split `[fromSec, toSec]` into windows no wider than the API limit. */
  private buildWindows(
    fromSec: number,
    toSec: number,
  ): Array<[number, number]> {
    const windows: Array<[number, number]> = [];
    let start = fromSec;
    while (start <= toSec) {
      const end = Math.min(start + MAX_STATEMENT_WINDOW_SEC, toSec);
      windows.push([start, end]);
      if (end >= toSec) break;
      start = end + 1;
    }
    return windows;
  }

  /** Per-request config carrying the `X-Token` header. */
  private authConfig(): AxiosRequestConfig {
    const token = this.config.getEnvConfig().MONOBANK_TOKEN;
    if (!token) {
      throw new BankAuthError('MONOBANK_TOKEN is not configured');
    }
    return { headers: { 'X-Token': token } };
  }

  /** Run a call, mapping Monobank's 429/403 to typed errors. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError) {
        const status = err.context.status;
        if (status === 429) {
          throw new BankRateLimitError(
            `Monobank rate limit hit — ${err.message}`,
            RATE_LIMIT_BACKOFF_SEC,
            err,
          );
        }
        if (status === 403) {
          throw new BankAuthError(
            `Monobank rejected the token (403) — ${err.message}`,
            err,
          );
        }
      }
      throw err;
    }
  }

  /** As {@link call}, but retries once after a backoff on a 429. */
  private async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.call(fn);
    } catch (err) {
      if (err instanceof BankRateLimitError) {
        this.logger.warn(
          `Monobank rate limited; retrying once in ${err.retryAfterSec}s`,
        );
        await this.sleep(err.retryAfterSec * 1000);
        return this.call(fn);
      }
      throw err;
    }
  }

  /** Overridable in tests so they don't actually wait. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
