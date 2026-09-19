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

  getInvoiceStatus(invoiceId: string): Promise<unknown> {
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
   */
  async verifyCallback(
    rawBody: Buffer,
    signatureB64: string,
  ): Promise<boolean> {
    const key = await this.getPublicKey();
    if (verifyWebhookSignature(rawBody, signatureB64, key)) return true;

    this.logger.warn(
      'Acquiring callback failed verification; refreshing the public key once',
    );
    const refreshed = await this.getPublicKey(true);
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
