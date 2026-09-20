import { Injectable, Logger } from '@nestjs/common';
import type { AxiosRequestConfig } from 'axios';
import { ConfigConnectorService } from '../config/config-connector.service';
import { HttpClientConnectorService } from '../http-client/http-client-connector.service';
import { verifyWebhookSignature } from './monobank-acquiring.signature';
import {
  CreateInvoiceResponseSchema,
  PubkeyResponseSchema,
  type TCreatedInvoice,
  type TCreateInvoiceParams,
} from './monobank-acquiring.types';

/** ISO 4217 for the hryvnia; every invoice is in UAH. */
const CCY_UAH = 980;

/**
 * Client for the Monobank acquiring («plata by mono») merchant API.
 *
 * Separate from `MonobankService` on purpose: that one speaks the Personal API
 * with `MONOBANK_TOKEN` and carries rate-limit retry logic for endpoints capped
 * at one call per minute. Acquiring uses a different credential, a different
 * path prefix and has no such cap, so sharing a class would mean two tokens and
 * two contracts in one place.
 */
@Injectable()
export class MonobankAcquiringService {
  private readonly logger = new Logger(MonobankAcquiringService.name);

  /** Cached per the docs' explicit instruction not to fetch it per webhook. */
  private publicKeyB64: string | null = null;

  constructor(
    private readonly http: HttpClientConnectorService,
    private readonly config: ConfigConnectorService,
  ) {}

  async createInvoice(params: TCreateInvoiceParams): Promise<TCreatedInvoice> {
    const raw = await this.http.post<unknown>(
      '/api/merchant/invoice/create',
      {
        amount: params.amount,
        ccy: CCY_UAH,
        paymentType: 'debit',
        validity: params.validitySec,
        redirectUrl: params.redirectUrl,
        webHookUrl: params.webHookUrl,
        merchantPaymInfo: {
          reference: params.reference,
          destination: params.destination,
        },
      },
      this.authConfig(),
    );
    return CreateInvoiceResponseSchema.parse(raw);
  }

  async getInvoiceStatus(invoiceId: string): Promise<unknown> {
    return this.http.get<unknown>(
      `/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`,
      this.authConfig(),
    );
  }

  /** Cached key; pass `force` to bypass the cache after a failed verification. */
  async getPublicKey(force = false): Promise<string> {
    if (!force && this.publicKeyB64) return this.publicKeyB64;
    const raw = await this.http.get<unknown>(
      '/api/merchant/pubkey',
      this.authConfig(),
    );
    this.publicKeyB64 = PubkeyResponseSchema.parse(raw).key;
    return this.publicKeyB64;
  }

  /**
   * Verifies a callback, refreshing the cached key exactly once if the first
   * attempt fails — that is the documented signal that the key has rotated.
   *
   * A malformed or forged push must resolve to `false` (→ a 403 to the
   * caller), never reject: an empty signature skips the network entirely
   * (no reason to spend a bank call on it, and no reason to let an
   * unauthenticated caller trigger unbounded `GET /api/merchant/pubkey`
   * traffic), and a failure while refreshing the key after a bad first
   * attempt is swallowed rather than propagated — a Monobank outage on the
   * refresh must not turn every in-flight callback into a 500.
   */
  async verifyCallback(
    rawBody: Buffer,
    signatureB64: string,
  ): Promise<boolean> {
    if (!signatureB64) return false;

    const key = await this.getPublicKey();
    if (verifyWebhookSignature(rawBody, signatureB64, key)) return true;

    this.logger.warn(
      'Acquiring callback failed verification; refreshing the public key once',
    );
    let refreshed: string;
    try {
      refreshed = await this.getPublicKey(true);
    } catch (err) {
      this.logger.error(
        'Failed to refresh the acquiring public key after a failed verification',
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
    return verifyWebhookSignature(rawBody, signatureB64, refreshed);
  }

  private authConfig(): AxiosRequestConfig {
    const token = this.config.getEnvConfig().MONOBANK_MERCHANT_TOKEN;
    if (!token) {
      throw new Error(
        'MONOBANK_MERCHANT_TOKEN is not configured — acquiring is unavailable',
      );
    }
    return { headers: { 'X-Token': token } };
  }
}
