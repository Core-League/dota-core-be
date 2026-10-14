import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ConfigConnectorService } from '../config/config-connector.service';
import {
  WfpRegularSchema,
  WfpTransactionSchema,
  formatWfpAmount,
  wfpDate,
  type TWfpPurchaseParams,
  type TWfpRegular,
  type TWfpRegularRequest,
  type TWfpTransaction,
} from './wayforpay.types';

const PAY_URL = 'https://secure.wayforpay.com/pay?behavior=offline';
const API_URL = 'https://api.wayforpay.com/api';
const REGULAR_URL = 'https://api.wayforpay.com/regularApi';

const HTTP_TIMEOUT_MS = 15_000;

/** Every Core League payment is in hryvnias. */
const CURRENCY = 'UAH';

type TFetch = (url: string, init: RequestInit) => Promise<Response>;

/** A field as it goes into a signed string: numbers as JSON prints them, absent ones empty. */
function signedField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value);
}

/**
 * Client for the WayForPay merchant API — the same integration Oathfall runs
 * (owner 2026-10-14: Core League moves its checkout from Monobank acquiring
 * to WayForPay).
 *
 * - A Purchase in "offline" mode hands back a payment page URL; the outcome is
 *   posted, signed with HMAC-MD5 of the SecretKey, to `serviceUrl`, and
 *   CHECK_STATUS is the fallback when a callback is late.
 * - VIP is a WayForPay regular payment: the first Purchase carries
 *   `regularMode=monthly`, WayForPay charges the card every month by itself,
 *   and regularApi (merchant password) reports, suspends, resumes and removes it.
 *
 * Configured by WAYFORPAY_MERCHANT_ACCOUNT / _SECRET_KEY / _MERCHANT_PASSWORD;
 * until they are set every flow keeps using Monobank acquiring.
 * Docs: https://wiki.wayforpay.com/uk
 */
@Injectable()
export class WayForPayService {
  /** Indirection over `fetch` so specs can answer for WayForPay. */
  fetchFn: TFetch = (url, init) => fetch(url, init);

  constructor(private readonly config: ConfigConnectorService) {}

  /** True once the merchant credentials are configured: WayForPay takes every new payment. */
  isConfigured(): boolean {
    const env = this.config.getEnvConfig();
    return !!(
      env.WAYFORPAY_MERCHANT_ACCOUNT &&
      env.WAYFORPAY_SECRET_KEY &&
      env.WAYFORPAY_MERCHANT_PASSWORD
    );
  }

  /** HMAC-MD5 (hex) over the fields joined with ";". */
  sign(fields: unknown[]): string {
    return createHmac('md5', this.creds().secretKey)
      .update(fields.map(signedField).join(';'), 'utf8')
      .digest('hex');
  }

  /** Creates the payment page; returns its URL. */
  async purchase(params: TWfpPurchaseParams): Promise<{ url: string }> {
    const { merchantAccount, domain } = this.creds();
    const amount = formatWfpAmount(params.amount);
    const orderDate = Math.floor(Date.now() / 1000);
    const signature = this.sign([
      merchantAccount,
      domain,
      params.orderReference,
      orderDate,
      amount,
      CURRENCY,
      params.productName,
      1,
      amount,
    ]);
    const form = new URLSearchParams({
      merchantAccount,
      merchantAuthType: 'SimpleSignature',
      merchantDomainName: domain,
      merchantTransactionType: 'SALE',
      merchantTransactionSecureType: 'AUTO',
      merchantSignature: signature,
      apiVersion: '1',
      language: 'UA',
      orderReference: params.orderReference,
      orderDate: String(orderDate),
      amount,
      currency: CURRENCY,
      orderLifetime: String(params.lifetimeSec),
      'productName[]': params.productName,
      'productPrice[]': amount,
      'productCount[]': '1',
      paymentSystems: 'card;applePay;googlePay',
      serviceUrl: params.serviceUrl,
      returnUrl: params.returnUrl,
    });
    if (params.clientAccountId) {
      form.set('clientAccountId', params.clientAccountId);
    }
    if (params.regular) {
      form.set('regularMode', 'monthly');
      form.set('regularOn', '1');
      form.set('regularBehavior', 'preset');
      form.set('regularAmount', amount);
      form.set('dateNext', wfpDate(params.regular.dateNext));
      form.set('dateEnd', wfpDate(params.regular.dateEnd));
    }
    const raw = await this.post(
      PAY_URL,
      form.toString(),
      'application/x-www-form-urlencoded',
    );
    const parsed = z
      .object({ url: z.string().url() })
      .passthrough()
      .safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `WayForPay purchase refused: ${JSON.stringify(raw).slice(0, 300)}`,
      );
    }
    return { url: parsed.data.url };
  }

  /** CHECK_STATUS of one order. Unknown orders come back "Declined" with reasonCode 1127. */
  async checkStatus(orderReference: string): Promise<TWfpTransaction> {
    const { merchantAccount } = this.creds();
    const raw = await this.post(
      API_URL,
      JSON.stringify({
        transactionType: 'CHECK_STATUS',
        merchantAccount,
        orderReference,
        merchantSignature: this.sign([merchantAccount, orderReference]),
        apiVersion: 1,
      }),
      'application/json',
    );
    return WfpTransactionSchema.parse({ orderReference, ...(raw as object) });
  }

  /** regularApi call for the VIP subscription created by `orderReference` (its paid first month). */
  async regular(
    requestType: TWfpRegularRequest,
    orderReference: string,
  ): Promise<TWfpRegular> {
    const { merchantAccount, merchantPassword } = this.creds();
    const raw = await this.post(
      REGULAR_URL,
      JSON.stringify({
        requestType,
        merchantAccount,
        merchantPassword,
        orderReference,
      }),
      'application/json',
    );
    return WfpRegularSchema.parse(raw);
  }

  /** Checks a callback's merchantSignature. Never throws: a forged push is just `false` (→ 403). */
  verify(tx: TWfpTransaction): boolean {
    if (!this.isConfigured()) return false;
    const { merchantAccount } = this.creds();
    if (!tx.merchantSignature || tx.merchantAccount !== merchantAccount) {
      return false;
    }
    const expected = Buffer.from(
      this.sign([
        tx.merchantAccount,
        tx.orderReference,
        tx.amount,
        tx.currency,
        tx.authCode,
        tx.cardPan,
        tx.transactionStatus,
        tx.reasonCode,
      ]),
    );
    const got = Buffer.from(tx.merchantSignature.toLowerCase());
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  /** The signed answer WayForPay waits for after a callback (else it retries for days). */
  acceptReply(orderReference: string): {
    orderReference: string;
    status: 'accept';
    time: number;
    signature: string;
  } {
    const time = Math.floor(Date.now() / 1000);
    return {
      orderReference,
      status: 'accept',
      time,
      signature: this.sign([orderReference, 'accept', time]),
    };
  }

  private creds(): {
    merchantAccount: string;
    secretKey: string;
    merchantPassword: string;
    domain: string;
  } {
    const env = this.config.getEnvConfig();
    if (!this.isConfigured()) {
      throw new Error(
        'WAYFORPAY_MERCHANT_ACCOUNT / WAYFORPAY_SECRET_KEY / WAYFORPAY_MERCHANT_PASSWORD are not configured',
      );
    }
    return {
      merchantAccount: env.WAYFORPAY_MERCHANT_ACCOUNT,
      secretKey: env.WAYFORPAY_SECRET_KEY,
      merchantPassword: env.WAYFORPAY_MERCHANT_PASSWORD,
      domain: env.WAYFORPAY_DOMAIN,
    };
  }

  private async post(
    url: string,
    body: string,
    contentType: string,
  ): Promise<unknown> {
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `WayForPay ${url}: HTTP ${res.status} ${text.slice(0, 200)}`,
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`WayForPay ${url}: not JSON: ${text.slice(0, 200)}`);
    }
  }
}
