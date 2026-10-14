import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigConnectorService } from '../connectors/config/config-connector.service';
import { MonobankAcquiringService } from '../connectors/monobank-acquiring/monobank-acquiring.service';
import type { TInvoiceCallbackPayload } from '../connectors/monobank-acquiring/monobank-acquiring.types';
import { WayForPayService } from '../connectors/wayforpay/wayforpay.service';
import { wfpOrderReference } from '../connectors/wayforpay/wayforpay.types';
import { SUPPORT_PRODUCT_NAME } from '../legal/legal.constants';
import {
  assertPaymentConsent,
  recordPaymentConsent,
  type TPaymentConsentInput,
} from '../legal/payment-consent';
import {
  PaymentConsentProduct,
  type TPaymentConsentProvider,
} from '../legal/payment-consent.entity';
import { Tournament } from './tournaments.entity';
import { TournamentDonation } from './tournament-donation.entity';
import { TournamentDonationRepository } from './tournament-donation.repository';
import { PaymentStatus } from './tournament-team-payment.model';
import { nextPaymentState } from './tournament-payment-transition';
import { TournamentDonationIntentDto } from './dto/tournament-donation-intent.dto';
import {
  acquiringWebHookUrlFrom,
  tournamentRedirectUrlFrom,
  wayforpayServiceUrlFrom,
} from './acquiring-urls.util';
import type { TRequestHeaders } from './request-origin.util';

/** A donation invoice stays payable for a day; there is no registration window to fit inside. */
export const DONATION_INVOICE_VALIDITY_SEC = 24 * 3600;

@Injectable()
export class TournamentDonationsService {
  private readonly logger = new Logger(TournamentDonationsService.name);

  constructor(
    private readonly donationRepo: TournamentDonationRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly acquiring: MonobankAcquiringService,
    private readonly config: ConfigConnectorService,
    /** Takes every new donation once configured (owner 2026-10-14); Monobank until then. */
    private readonly wayforpay?: WayForPayService,
  ) {}

  /**
   * Mints a new donation and its payment page (WayForPay, or Monobank before
   * the switch). Every call is a fresh row:
   * donations have no natural key to find-or-create on, so two clicks are two
   * donations by design. Allowed in any tournament status, COMPLETED included.
   *
   * Refused without consent to the current legal documents; the minted page
   * and its `payment_consent` row are saved in one transaction.
   */
  async createIntent(
    tournamentId: string,
    amount: number,
    headers: TRequestHeaders,
    consent: TPaymentConsentInput,
    donorPlayerId: string | null = null,
  ): Promise<TournamentDonationIntentDto> {
    assertPaymentConsent(consent);
    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Турнір не знайдено');

    const reference = await this.donationRepo.generateUniqueReference();
    let donation = await this.donationRepo.save(
      this.donationRepo.create({
        tournamentId,
        reference,
        amount,
        amountPaid: 0,
        status: PaymentStatus.PENDING,
        invoiceId: null,
        paymentPageUrl: null,
        donorPlayerId,
      }),
    );

    const env = this.config.getEnvConfig();
    if (this.wayforpay?.isConfigured()) {
      const expiresAt = new Date(
        Date.now() + DONATION_INVOICE_VALIDITY_SEC * 1000,
      );
      const orderReference = wfpOrderReference(reference, expiresAt);
      const page = await this.wayforpay.purchase({
        orderReference,
        amount,
        productName: SUPPORT_PRODUCT_NAME,
        serviceUrl: wayforpayServiceUrlFrom(headers),
        returnUrl: tournamentRedirectUrlFrom(
          headers,
          env.CORS_ORIGINS,
          tournamentId,
        ),
        lifetimeSec: DONATION_INVOICE_VALIDITY_SEC,
      });
      donation.invoiceId = orderReference;
      donation.paymentPageUrl = page.url;
      donation = await this.saveMintedPage(donation, 'wayforpay');
      return this.toIntentDto(donation);
    }
    if (!env.MONOBANK_MERCHANT_TOKEN) {
      // The only case that legitimately yields `pageUrl: null`. The row stays
      // PENDING with no invoice, mirroring an entry fee on an unconfigured box.
      this.logger.warn(
        `Donation ${reference}: MONOBANK_MERCHANT_TOKEN is not configured — no invoice created`,
      );
      return this.toIntentDto(donation);
    }

    // Both URLs come from the request, never from env, and both throw loudly
    // when a host cannot be derived — see acquiring-urls.util.
    const webHookUrl = acquiringWebHookUrlFrom(headers);
    const redirectUrl = tournamentRedirectUrlFrom(
      headers,
      env.CORS_ORIGINS,
      tournamentId,
    );

    const invoice = await this.acquiring.createInvoice({
      amount,
      reference,
      destination: SUPPORT_PRODUCT_NAME,
      redirectUrl,
      webHookUrl,
      validitySec: DONATION_INVOICE_VALIDITY_SEC,
    });
    donation.invoiceId = invoice.invoiceId;
    donation.paymentPageUrl = invoice.pageUrl;
    donation = await this.saveMintedPage(donation, 'monobank');

    return this.toIntentDto(donation);
  }

  /**
   * Records a newly minted page on the donation row and logs the payer's
   * consent in the same transaction: both land, or neither does.
   */
  private saveMintedPage(
    donation: TournamentDonation,
    provider: TPaymentConsentProvider,
  ): Promise<TournamentDonation> {
    return this.dataSource.transaction(async (manager) => {
      const saved = await manager
        .getRepository(TournamentDonation)
        .save(donation);
      await recordPaymentConsent(manager, {
        playerId: donation.donorPlayerId ?? null,
        product: PaymentConsentProduct.SUPPORT,
        reference: donation.reference,
        amountKopecks: donation.amount,
        provider,
      });
      return saved;
    });
  }

  private toIntentDto(
    donation: TournamentDonation,
  ): TournamentDonationIntentDto {
    return {
      reference: donation.reference,
      amount: donation.amount,
      pageUrl: donation.paymentPageUrl,
    };
  }

  /**
   * Applies one acquiring callback to a donation. Returns false when no
   * donation matches so the dispatcher can fall through to its final
   * "unattributable" log. Idempotent and order-independent through
   * `nextPaymentState`, exactly like the entry-fee flow.
   */
  async applyInvoiceCallback(
    payload: TInvoiceCallbackPayload,
  ): Promise<boolean> {
    // invoiceId is the precise key; reference covers a push that predates the
    // row storing its invoice (e.g. a retry arriving after a failure cleared it).
    const donation =
      (await this.donationRepo.findByInvoiceId(payload.invoiceId)) ??
      (payload.reference
        ? await this.donationRepo.findByReference(payload.reference)
        : null);
    if (!donation) return false;

    const change = nextPaymentState(donation, payload, new Date());
    if (!change) return true;

    donation.status = change.status;
    donation.amountPaid = change.amountPaid;
    donation.paidAt = change.paidAt;
    donation.invoiceId = change.invoiceId;
    donation.paymentPageUrl = change.paymentPageUrl;
    await this.donationRepo.save(donation);

    this.logger.log(
      `Donation ${donation.reference}: invoice ${payload.invoiceId} -> ${payload.status} (${change.status})`,
    );
    return true;
  }
}
