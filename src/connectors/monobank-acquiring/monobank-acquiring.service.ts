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
  type TWalletPaymentParams,
  type TWalletPaymentResult,
  WalletPaymentResponseSchema,
} from './monobank-acquiring.types';

/** ISO 4217 for the hryvnia; every invoice is in UAH. */
const CCY_UAH = 980;

/**
 * Minimum gap between forced key refetches triggered by a failed
 * verification. `GET /api/merchant/pubkey` is public and unauthenticated by
 * construction, so without this bound a flood of garbage-signature POSTs —
 * each of which fails verification and would otherwise trigger its own
 * forced refetch — costs one outbound Monobank call per request. Monobank
 * rate-limits that endpoint; once exhausted, verification of *genuine*
 * callbacks starts failing too and payments silently stop settling. The
 * cooldown caps the damage at one refetch per window regardless of how many
 * requests arrive. Tradeoff: a real key rotation is noticed up to one
 * window late, which is fine against Monobank's own callback retry budget.
 */
export const PUBKEY_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

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

  /**
   * Epoch ms of the last forced-refresh *attempt* (set whether or not it
   * succeeded) — gates {@link PUBKEY_REFRESH_COOLDOWN_MS}. Zero means "never
   * attempted", which is always outside the cooldown.
   */
  private lastForcedRefreshAt = 0;

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
        ...(params.saveCardWalletId
          ? {
              saveCardData: {
                saveCard: true,
                walletId: params.saveCardWalletId,
              },
            }
          : {}),
      },
      this.authConfig(),
    );
    return CreateInvoiceResponseSchema.parse(raw);
  }

  /**
   * Merchant-initiated charge of a tokenized card (no payer interaction), used
   * for VIP renewals. Monobank settles it asynchronously through `webHookUrl`.
   */
  async walletPayment(
    params: TWalletPaymentParams,
  ): Promise<TWalletPaymentResult> {
    const raw = await this.http.post<unknown>(
      '/api/merchant/wallet/payment',
      {
        cardToken: params.cardToken,
        amount: params.amount,
        ccy: CCY_UAH,
        initiationKind: 'merchant',
        paymentType: 'debit',
        webHookUrl: params.webHookUrl,
        ...(params.redirectUrl ? { redirectUrl: params.redirectUrl } : {}),
        merchantPaymInfo: {
          reference: params.reference,
          destination: params.destination,
        },
      },
      this.authConfig(),
    );
    return WalletPaymentResponseSchema.parse(raw);
  }

  /** Invalidates an unpaid invoice so it can no longer be paid. */
  async removeInvoice(invoiceId: string): Promise<void> {
    await this.http.post<unknown>(
      '/api/merchant/invoice/remove',
      { invoiceId },
      this.authConfig(),
    );
  }

  /** Forgets a tokenized card (VIP auto-renewal switched off for good). */
  async deleteCardToken(cardToken: string): Promise<void> {
    await this.http.delete<unknown>(
      `/api/merchant/wallet/card?cardToken=${encodeURIComponent(cardToken)}`,
      this.authConfig(),
    );
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
   * attempt fails — that is the documented signal that the key has rotated —
   * and only if {@link PUBKEY_REFRESH_COOLDOWN_MS} has elapsed since the last
   * such attempt.
   *
   * A malformed or forged push must resolve to `false` (→ a 403 to the
   * caller), never reject: an empty signature skips the network entirely,
   * a signature still within the refresh cooldown skips it too (both guard
   * against the same thing — an unauthenticated caller forcing unbounded
   * `GET /api/merchant/pubkey` traffic), and a failure while refreshing the
   * key is swallowed rather than propagated — a Monobank outage on the
   * refresh must not turn every in-flight callback into a 500.
   */
  async verifyCallback(
    rawBody: Buffer,
    signatureB64: string,
  ): Promise<boolean> {
    if (!signatureB64) return false;

    const key = await this.getPublicKey();
    if (verifyWebhookSignature(rawBody, signatureB64, key)) return true;

    if (this.now() - this.lastForcedRefreshAt < PUBKEY_REFRESH_COOLDOWN_MS) {
      this.logger.warn(
        'Acquiring callback failed verification; skipping refresh — still within the cooldown window',
      );
      return false;
    }

    this.logger.warn(
      'Acquiring callback failed verification; refreshing the public key once',
    );
    // Set before the attempt, not after: a failing fetch must still start the
    // cooldown, or a flood of requests keeps re-attempting the refetch on
    // every single one instead of at most once per window.
    this.lastForcedRefreshAt = this.now();
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

  /** Indirection over `Date.now()` so cooldown tests can control the clock without `jest.useFakeTimers`. */
  private now(): number {
    return Date.now();
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
