import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThan,
} from 'typeorm';
import { ChatAccessEvents } from '../chat/chat-access.events';
import { ConfigConnectorService } from '../connectors/config/config-connector.service';
import { MonobankAcquiringService } from '../connectors/monobank-acquiring/monobank-acquiring.service';
import {
  InvoiceCallbackSchema,
  type TInvoiceCallbackPayload,
} from '../connectors/monobank-acquiring/monobank-acquiring.types';
import { WayForPayService } from '../connectors/wayforpay/wayforpay.service';
import {
  WFP_REGULAR_GONE,
  WFP_REGULAR_OK,
  wfpAmountToKopecks,
  wfpOrderReference,
  wfpTime,
  type TWfpTransaction,
} from '../connectors/wayforpay/wayforpay.types';
import {
  VIP_PRODUCT_NAME,
  VIP_RENEWAL_PRODUCT_NAME,
} from '../legal/legal.constants';
import {
  assertPaymentConsent,
  recordPaymentConsent,
  type TPaymentConsentInput,
} from '../legal/payment-consent';
import {
  PaymentConsentProduct,
  type TPaymentConsentProvider,
} from '../legal/payment-consent.entity';
import { Player } from '../players/player.entity';
import {
  acquiringWebHookUrlFrom,
  wayforpayServiceUrlFrom,
} from '../tournaments/acquiring-urls.util';
import {
  spaOriginFrom,
  type TRequestHeaders,
} from '../tournaments/request-origin.util';
import { generatePaymentReference } from '../tournaments/tournament-team-payment.util';
import {
  AdminVipResultDto,
  VipCheckoutDto,
  VipPaymentNoticeDto,
  VipStatusDto,
} from './dto/vip.dto';
import { VipPayment } from './vip-payment.entity';
import { VipSubscription } from './vip-subscription.entity';
import {
  VIP_FRAME_COLORS,
  VIP_INVOICE_VALIDITY_SEC,
  VIP_LIFETIME_UNTIL,
  VIP_MONTHLY_PRICE_KOPECKS,
  VIP_PERIOD_MONTHS,
  VIP_REFERENCE_PREFIX,
  VIP_RENEWAL_CLAIM_TTL_MINUTES,
  VIP_RENEWAL_LEAD_HOURS,
  VIP_RENEWAL_MAX_ATTEMPTS,
  VIP_RENEWAL_RETRY_HOURS,
  VIP_SWITCH_DISCOUNT_PERCENT,
  VIP_WFP_CHARGE_GRACE_HOURS,
  VIP_WFP_GIVE_UP_HOURS,
  VIP_WFP_RECHECK_HOURS,
  VIP_WFP_REGULAR_YEARS,
  VipPaymentKind,
  VipPaymentStatus,
  VipProvider,
  isVipFrameColor,
} from './vip.constants';
import {
  addHours,
  addMonths,
  isVipActive,
  isVipLifetime,
  toVipPublicFields,
  vipMonthlyPrice,
} from './vip.utils';

/** Renewals charged per scheduler tick; the rest wait for the next one. */
const RENEWAL_BATCH = 20;

/** Monobank statuses that end an invoice without money. */
const FAILED_INVOICE_STATUSES = new Set(['failure', 'expired', 'reversed']);

/** Two WayForPay charges closer than this are one charge reported twice. */
const WFP_SAME_CHARGE_MS = 24 * 3600 * 1000;

/**
 * VIP status: 200 ₴ a month, or granted by an admin.
 *
 * Payment rails:
 * - **WayForPay** (since 2026-10-14, once its credentials are configured):
 *   the first Purchase carries `regularMode=monthly` and WayForPay charges the
 *   card every month by itself. A charge is seen through its callback or, as
 *   the backstop, through regularApi STATUS read by {@link VipRenewalScheduler};
 *   every charge seen extends VIP by a month.
 * - **Monobank acquiring** (before): the first invoice tokenizes the card and
 *   {@link VipRenewalScheduler} charges the token before `vipUntil`. At the
 *   switch every Monobank subscription is cancelled once (VIP already paid for
 *   runs to its end) and its payers get 10% off every future month plus a
 *   one-time pop-up ({@link retireMonoSubscriptions}).
 *
 * VIP itself is only `player.vipUntil`, so an admin grant and a payment are the
 * same thing to the rest of the app.
 */
@Injectable()
export class VipService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VipService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly acquiring: MonobankAcquiringService,
    private readonly config: ConfigConnectorService,
    private readonly chatAccess: ChatAccessEvents,
    private readonly wayforpay?: WayForPayService,
  ) {}

  onApplicationBootstrap(): void {
    void this.retireMonoSubscriptions().catch((err: unknown) =>
      this.logger.error(
        'Retiring Monobank VIP subscriptions failed; the next start retries',
        err instanceof Error ? err.stack : undefined,
      ),
    );
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async getStatus(playerId: string): Promise<VipStatusDto> {
    const player = await this.dataSource
      .getRepository(Player)
      .findOne({ where: { id: playerId }, relations: ['roles'] });
    if (!player) throw new NotFoundException('Гравця не знайдено');
    let pending = await this.countPendingCheckouts(playerId);
    if (pending > 0 && (await this.refreshPendingWayForPay(playerId))) {
      pending = await this.countPendingCheckouts(playerId);
      await this.reloadVipFields(player);
    }
    const [subscription, seenAt] = await Promise.all([
      this.dataSource
        .getRepository(VipSubscription)
        .findOne({ where: { playerId } }),
      this.noticeSeenAt(playerId),
    ]);
    const discountPercent = subscription?.discountPercent ?? 0;
    const isAdmin = (player.roles ?? []).some((r) => r.isAdminRole);
    return {
      ...toVipPublicFields(player),
      priceKopecks: vipMonthlyPrice(discountPercent),
      fullPriceKopecks: VIP_MONTHLY_PRICE_KOPECKS,
      discountPercent,
      paymentProvider: this.paymentProvider(),
      paymentNotice: this.paymentNotice(player, subscription, isAdmin, seenAt),
      frameColors: [...VIP_FRAME_COLORS],
      autoRenew: !!subscription?.autoRenew,
      nextChargeAt: subscription?.autoRenew
        ? (subscription.nextChargeAt ?? null)
        : null,
      maskedPan: subscription?.maskedPan ?? null,
      hasSavedCard: this.canResume(subscription),
      paymentPending: pending > 0,
    };
  }

  /** Who takes new payments: WayForPay once configured, else Monobank acquiring. */
  paymentProvider(): 'wayforpay' | 'monobank' | null {
    if (this.wfp()) return 'wayforpay';
    return this.config.getEnvConfig().MONOBANK_MERCHANT_TOKEN
      ? 'monobank'
      : null;
  }

  // ── player mutations ─────────────────────────────────────────────────────

  /**
   * Creates the first-payment page and returns it. Monobank tokenizes the card;
   * WayForPay starts a monthly regular payment. Refused while auto-renewal is
   * already on — the card is charged automatically then, and refused without
   * consent to the current legal documents. The minted page and its
   * `payment_consent` row are saved in one transaction.
   */
  async checkout(
    playerId: string,
    headers: TRequestHeaders,
    consent: TPaymentConsentInput,
  ): Promise<VipCheckoutDto> {
    assertPaymentConsent(consent);
    const buyer = await this.findPlayer(playerId);
    if (isVipLifetime(buyer)) {
      throw new ConflictException({
        error: 'vip_lifetime',
        message: 'У вас безстроковий VIP — оплата не потрібна',
      });
    }
    const subscriptions = this.dataSource.getRepository(VipSubscription);
    const existing = await subscriptions.findOne({ where: { playerId } });
    if (existing?.autoRenew && this.canResume(existing)) {
      throw new ConflictException({
        error: 'vip_already_subscribed',
        message: 'Підписка VIP уже активна — вона продовжиться автоматично',
      });
    }

    const payments = this.dataSource.getRepository(VipPayment);
    let payment = await payments.save(
      payments.create({
        playerId,
        reference: await this.generateReference(),
        kind: VipPaymentKind.INITIAL,
        status: VipPaymentStatus.PENDING,
        amount: vipMonthlyPrice(existing?.discountPercent ?? 0),
        invoiceId: null,
        pageUrl: null,
      }),
    );

    const wfp = this.wfp();
    if (wfp) return this.checkoutWayForPay(wfp, buyer, payment, headers);

    const env = this.config.getEnvConfig();
    if (!env.MONOBANK_MERCHANT_TOKEN) {
      this.logger.warn(
        `VIP ${payment.reference}: no payment provider is configured — no invoice created`,
      );
      return {
        pageUrl: null,
        reference: payment.reference,
        amount: payment.amount,
      };
    }

    // Both URLs come from the request — see acquiring-urls.util for why.
    const webHookUrl = acquiringWebHookUrlFrom(headers);
    const redirectUrl = this.redirectUrlFrom(headers);

    await subscriptions.save(
      existing
        ? Object.assign(existing, { webHookUrl })
        : subscriptions.create({
            playerId,
            walletId: playerId,
            cardToken: null,
            maskedPan: null,
            autoRenew: false,
            nextChargeAt: null,
            failedAttempts: 0,
            renewalClaimedAt: null,
            webHookUrl,
          }),
    );

    const invoice = await this.acquiring.createInvoice({
      amount: payment.amount,
      reference: payment.reference,
      destination: VIP_PRODUCT_NAME,
      redirectUrl,
      webHookUrl,
      validitySec: VIP_INVOICE_VALIDITY_SEC,
      saveCardWalletId: playerId,
    });
    payment.invoiceId = invoice.invoiceId;
    payment.pageUrl = invoice.pageUrl;
    payment = await this.saveMintedPage(payment, 'monobank');

    return {
      pageUrl: payment.pageUrl,
      reference: payment.reference,
      amount: payment.amount,
    };
  }

  /**
   * The WayForPay page: this month now, then the same amount every month. The
   * first regular charge falls the day before the month bought here runs out,
   * so a running VIP never lapses between charges.
   */
  private async checkoutWayForPay(
    wfp: WayForPayService,
    buyer: Player,
    payment: VipPayment,
    headers: TRequestHeaders,
  ): Promise<VipCheckoutDto> {
    const serviceUrl = wayforpayServiceUrlFrom(headers);
    const returnUrl = this.redirectUrlFrom(headers);
    const now = new Date();
    const orderReference = wfpOrderReference(
      payment.reference,
      new Date(now.getTime() + VIP_INVOICE_VALIDITY_SEC * 1000),
    );
    const periodEnd = addMonths(
      this.periodAnchor(buyer, now),
      VIP_PERIOD_MONTHS,
    );
    const dateNext = addHours(periodEnd, -24);
    const payments = this.dataSource.getRepository(VipPayment);
    try {
      const page = await wfp.purchase({
        orderReference,
        amount: payment.amount,
        productName: VIP_PRODUCT_NAME,
        serviceUrl,
        returnUrl,
        lifetimeSec: VIP_INVOICE_VALIDITY_SEC,
        clientAccountId: buyer.id,
        regular: {
          dateNext,
          dateEnd: addMonths(dateNext, VIP_WFP_REGULAR_YEARS * 12),
        },
      });
      payment.invoiceId = orderReference;
      payment.pageUrl = page.url;
    } catch (err) {
      payment.status = VipPaymentStatus.FAILED;
      payment.failureReason =
        `WayForPay purchase failed: ${err instanceof Error ? err.message : String(err)}`.slice(
          0,
          250,
        );
      await payments.save(payment);
      this.logger.error(`VIP ${payment.reference}: ${payment.failureReason}`);
      throw new BadGatewayException({
        error: 'payment_provider',
        message: 'Платіжний сервіс не відповів — спробуйте за хвилину',
      });
    }
    payment = await this.saveMintedPage(payment, 'wayforpay');
    return {
      pageUrl: payment.pageUrl,
      reference: payment.reference,
      amount: payment.amount,
    };
  }

  /**
   * Records a newly minted checkout page on the payment row and logs the
   * payer's consent in the same transaction: both land, or neither does.
   */
  private saveMintedPage(
    payment: VipPayment,
    provider: TPaymentConsentProvider,
  ): Promise<VipPayment> {
    return this.dataSource.transaction(async (em) => {
      const saved = await em.getRepository(VipPayment).save(payment);
      await recordPaymentConsent(em, {
        playerId: payment.playerId,
        product: PaymentConsentProduct.VIP,
        reference: payment.reference,
        amountKopecks: payment.amount,
        provider,
      });
      return saved;
    });
  }

  /** Stops future charges (a WayForPay regular payment is suspended there first); VIP stays until `vipUntil`. */
  async cancelAutoRenew(playerId: string): Promise<VipStatusDto> {
    const repo = this.dataSource.getRepository(VipSubscription);
    const subscription = await repo.findOne({ where: { playerId } });
    if (subscription?.autoRenew) {
      if (
        subscription.provider === VipProvider.WAYFORPAY &&
        subscription.regularRef
      ) {
        await this.regularCommand(subscription.regularRef, 'SUSPEND');
      }
      subscription.autoRenew = false;
      subscription.nextChargeAt = null;
      await repo.save(subscription);
      this.logger.log(`VIP auto-renewal cancelled by player ${playerId}`);
    }
    return this.getStatus(playerId);
  }

  /** Switches auto-renewal back on (a suspended WayForPay payment is resumed); only while VIP still lasts. */
  async resumeAutoRenew(playerId: string): Promise<VipStatusDto> {
    const player = await this.findPlayer(playerId);
    const repo = this.dataSource.getRepository(VipSubscription);
    const subscription = await repo.findOne({ where: { playerId } });
    if (!subscription || !this.canResume(subscription)) {
      throw new BadRequestException({
        error: 'vip_no_saved_card',
        message: 'Немає збереженої картки — оформіть підписку ще раз',
      });
    }
    if (!isVipActive(player) || !player.vipUntil) {
      throw new BadRequestException({
        error: 'vip_expired',
        message: 'VIP уже закінчився — оформіть підписку ще раз',
      });
    }
    if (
      subscription.provider === VipProvider.WAYFORPAY &&
      subscription.regularRef &&
      !subscription.autoRenew
    ) {
      await this.regularCommand(subscription.regularRef, 'RESUME');
    }
    subscription.autoRenew = true;
    subscription.failedAttempts = 0;
    subscription.nextChargeAt = addHours(
      player.vipUntil,
      -VIP_RENEWAL_LEAD_HOURS,
    );
    await repo.save(subscription);
    return this.getStatus(playerId);
  }

  /** The "payment method changed" pop-up was read: never shown again (any device). */
  async ackPaymentNotice(playerId: string): Promise<VipStatusDto> {
    await this.dataSource
      .getRepository(Player)
      .update({ id: playerId }, { vipPaymentNoticeSeenAt: new Date() });
    return this.getStatus(playerId);
  }

  async setFrameColor(
    playerId: string,
    color: string | null,
  ): Promise<VipStatusDto> {
    await this.applyFrameColor(playerId, color);
    return this.getStatus(playerId);
  }

  /** Shared by the player's own picker and the admin override: same palette, VIP only. */
  private async applyFrameColor(
    playerId: string,
    color: string | null,
  ): Promise<Player> {
    const player = await this.findPlayer(playerId);
    if (!isVipActive(player)) {
      throw new ForbiddenException({
        error: 'vip_required',
        message: 'Колір рамки доступний лише з VIP-статусом',
      });
    }
    const normalized = color ? color.toUpperCase() : null;
    if (normalized && !isVipFrameColor(normalized)) {
      throw new BadRequestException({
        error: 'vip_color_not_allowed',
        message: 'Цей колір недоступний — він закріплений за роллю',
      });
    }
    await this.dataSource
      .getRepository(Player)
      .update({ id: playerId }, { vipFrameColor: normalized });
    player.vipFrameColor = normalized;
    return player;
  }

  // ── admin ────────────────────────────────────────────────────────────────

  /** Adds `months` on top of the current VIP period (or from now), no payment. */
  async adminGrant(
    playerId: string,
    grant: { months?: number; lifetime?: boolean },
    adminId: string,
  ): Promise<AdminVipResultDto> {
    const months = grant.months ?? 0;
    if (!grant.lifetime && months < 1) {
      throw new BadRequestException(
        'Вкажіть кількість місяців або безстроковий VIP',
      );
    }
    const player = await this.dataSource.transaction(async (em) => {
      const row = await this.lockPlayer(em, playerId);
      if (grant.lifetime) {
        row.vipUntil = VIP_LIFETIME_UNTIL;
        await em.save(row);
        // Lifetime needs no payments: never charge the saved card again.
        await em
          .getRepository(VipSubscription)
          .update({ playerId }, { autoRenew: false, nextChargeAt: null });
        return row;
      }
      // Months on top of a lifetime VIP change nothing.
      if (!isVipLifetime(row)) {
        row.vipUntil = addMonths(this.periodAnchor(row), months);
        await em.save(row);
        await this.rescheduleRenewal(em, row);
      }
      return row;
    });
    if (grant.lifetime) await this.removeRegularOf(playerId);
    this.logger.log(
      `VIP granted by admin ${adminId} to ${playerId}: ` +
        `${grant.lifetime ? 'lifetime' : `+${months} mo`}, until ${player.vipUntil?.toISOString()}`,
    );
    this.chatAccess.changed([playerId]);
    return this.toAdminResult(player);
  }

  /** Ends VIP now and stops auto-renewal, so a revoked player is not charged again. */
  async adminRevoke(
    playerId: string,
    adminId: string,
  ): Promise<AdminVipResultDto> {
    const player = await this.dataSource.transaction(async (em) => {
      const row = await this.lockPlayer(em, playerId);
      row.vipUntil = null;
      await em.save(row);
      await em
        .getRepository(VipSubscription)
        .update({ playerId }, { autoRenew: false, nextChargeAt: null });
      return row;
    });
    await this.removeRegularOf(playerId);
    this.logger.log(`VIP revoked by admin ${adminId} from ${playerId}`);
    this.chatAccess.changed([playerId]);
    return this.toAdminResult(player);
  }

  /** Admin sets (or resets with null) a VIP player's card frame colour. */
  async adminSetFrameColor(
    playerId: string,
    color: string | null,
    adminId: string,
  ): Promise<AdminVipResultDto> {
    const player = await this.applyFrameColor(playerId, color);
    this.logger.log(
      `VIP frame colour set by admin ${adminId} for ${playerId}: ${player.vipFrameColor ?? 'default'}`,
    );
    return this.toAdminResult(player);
  }

  // ── Monobank callbacks ───────────────────────────────────────────────────

  /**
   * Applies one verified acquiring callback. Returns false when no VIP payment
   * matches, so the dispatcher can fall through. Idempotent: a PAID row is
   * never settled again, and the row is locked while it is being settled.
   */
  async applyInvoiceCallback(
    payload: TInvoiceCallbackPayload,
  ): Promise<boolean> {
    const payments = this.dataSource.getRepository(VipPayment);
    const payment =
      (await payments.findOne({ where: { invoiceId: payload.invoiceId } })) ??
      (payload.reference?.startsWith(VIP_REFERENCE_PREFIX)
        ? await payments.findOne({ where: { reference: payload.reference } })
        : null);
    if (!payment) return false;

    if (payload.status === 'success') {
      await this.settleSuccess(payment.id, payload);
    } else if (payload.status === 'reversed') {
      await this.settleRefund(
        payment.id,
        payload.invoiceId,
        'Monobank: reversed',
      );
    } else if (FAILED_INVOICE_STATUSES.has(payload.status)) {
      await this.settleFailure(payment.id, payload);
    }
    return true;
  }

  private async settleSuccess(
    paymentId: string,
    payload: TInvoiceCallbackPayload,
  ): Promise<void> {
    // After the switch to WayForPay a late Monobank payment still buys its
    // month, but never turns Monobank auto-renewal back on.
    const saveCard = !this.wfp();
    // The token may be missing from a push; the invoice status always has it.
    const wallet =
      !saveCard || payload.walletData?.cardToken || !payload.invoiceId
        ? payload
        : await this.fetchInvoice(payload.invoiceId);

    const paidPlayerId = await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(VipPayment, {
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment || payment.status === VipPaymentStatus.PAID) return null;

      const now = new Date();
      payment.status = VipPaymentStatus.PAID;
      payment.paidAt = now;
      payment.invoiceId = payment.invoiceId ?? payload.invoiceId;
      payment.failureReason = null;
      await em.save(payment);

      const player = await this.lockPlayer(em, payment.playerId);
      player.vipUntil = addMonths(
        this.periodAnchor(player, now),
        VIP_PERIOD_MONTHS,
      );
      await em.save(player);

      const subscriptions = em.getRepository(VipSubscription);
      const subscription =
        (await subscriptions.findOne({
          where: { playerId: payment.playerId },
          lock: { mode: 'pessimistic_write' },
        })) ??
        subscriptions.create({
          playerId: payment.playerId,
          walletId: payment.playerId,
          autoRenew: false,
          failedAttempts: 0,
        });

      const cardToken = wallet?.walletData?.cardToken;
      if (saveCard && payment.kind === VipPaymentKind.INITIAL && cardToken) {
        subscription.cardToken = cardToken;
        subscription.maskedPan =
          wallet?.paymentInfo?.maskedPan ?? subscription.maskedPan ?? null;
        subscription.autoRenew = true;
      }
      subscription.failedAttempts = 0;
      subscription.renewalClaimedAt = null;
      subscription.nextChargeAt = subscription.autoRenew
        ? addHours(player.vipUntil, -VIP_RENEWAL_LEAD_HOURS)
        : null;
      await subscriptions.save(subscription);

      this.logger.log(
        `VIP ${payment.reference} (${payment.kind}) paid: player ${player.id} VIP until ` +
          `${player.vipUntil.toISOString()}, auto-renew ${subscription.autoRenew ? 'on' : 'off'}`,
      );
      return player.id;
    });
    // VIP chat channel: join the room / show the tab without a reload.
    if (paidPlayerId) this.chatAccess.changed([paidPlayerId]);
  }

  private async settleFailure(
    paymentId: string,
    payload: TInvoiceCallbackPayload,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(VipPayment, {
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) return;
      if (payment.status === VipPaymentStatus.PAID) {
        // A paid invoice reported dead (not a refund, see settleRefund): leave it.
        this.logger.warn(
          `VIP ${payment.reference}: paid invoice ${payload.invoiceId} is now "${payload.status}" — review manually`,
        );
        return;
      }
      if (payment.status === VipPaymentStatus.FAILED) return;

      payment.status = VipPaymentStatus.FAILED;
      payment.failureReason =
        payload.failureReason ?? payload.errCode ?? payload.status;
      await em.save(payment);

      if (payment.kind === VipPaymentKind.RENEWAL) {
        await this.recordRenewalFailure(em, payment.playerId);
      }
      this.logger.warn(
        `VIP ${payment.reference} (${payment.kind}) failed: ${payment.failureReason}`,
      );
    });
  }

  // ── WayForPay callbacks ──────────────────────────────────────────────────

  /**
   * Applies one verified WayForPay transaction. Returns false when it belongs
   * to no VIP payment or subscription, so the dispatcher can log it.
   * - Our own page (`invoiceId` = its order reference): Approved buys the
   *   month and makes this regular payment the subscription; Expired closes
   *   the page. A decline is not final — the page stays payable.
   * - An order we never issued that matches a subscription: WayForPay's own
   *   monthly charge. It is credited from regularApi STATUS (the one place a
   *   renewal is counted), so however it is reported it counts once.
   */
  async applyWayForPayCallback(tx: TWfpTransaction): Promise<boolean> {
    const payment = await this.dataSource
      .getRepository(VipPayment)
      .findOne({ where: { invoiceId: tx.orderReference } });
    if (payment) {
      if (payment.kind !== VipPaymentKind.INITIAL) return true;
      const status = tx.transactionStatus;
      if (status === 'Approved') {
        if (!(await this.playerExists(payment.playerId))) {
          // Paid on a page opened before the account was deleted: there is
          // nobody to credit, and the regular payment must not charge again.
          await this.removeRegular(payment.playerId, tx.orderReference);
          this.logger.error(
            `VIP ${payment.reference}: WayForPay order ${tx.orderReference} paid after the account was deleted — ` +
              'regular payment removed; refund it in the WayForPay cabinet',
          );
          return true;
        }
        await this.settleWayForPaySuccess(payment.id, tx);
      } else if (status === 'Expired') {
        await this.settleFailure(payment.id, {
          invoiceId: tx.orderReference,
          status: 'expired',
          failureReason: 'WayForPay: Expired',
        });
      } else if (status === 'Refunded' || status === 'Voided') {
        await this.settleRefund(
          payment.id,
          tx.orderReference,
          `WayForPay: ${status}`,
        );
      }
      return true;
    }

    const subscription = await this.findRegularSubscription(tx);
    if (!subscription) return false;
    this.logger.log(
      `VIP: WayForPay charge ${tx.orderReference} (${tx.transactionStatus ?? '?'}, ${String(tx.amount ?? '?')} ${tx.currency ?? ''}) ` +
        `matches the subscription of ${subscription.playerId}`,
    );
    if (tx.transactionStatus === 'Approved') {
      await this.syncRegular(subscription, false);
    } else if (
      tx.transactionStatus === 'Refunded' ||
      tx.transactionStatus === 'Voided'
    ) {
      await this.refundRegularCharge(subscription, tx);
    }
    return true;
  }

  // ── refunds ──────────────────────────────────────────────────────────────

  /**
   * A paid VIP payment was refunded or voided at the provider: the month it
   * bought is taken back and auto-renewal stops, so a refunded payer is never
   * charged again.
   * - `vipUntil` moves back by {@link VIP_PERIOD_MONTHS}, but never below now
   *   (VIP then simply ends) and never on a lapsed or lifetime VIP.
   * - The subscription this payment feeds (the WayForPay regular payment it
   *   started, or any renewal's) is switched off here and SUSPENDed at
   *   WayForPay — the same command as a player's cancel.
   * - Idempotent: the row goes PAID → REFUNDED under its lock, so a repeated
   *   or parallel callback finds REFUNDED and changes nothing. A payment that
   *   never settled is just closed as failed.
   */
  private async settleRefund(
    paymentId: string,
    invoiceId: string,
    reason: string,
  ): Promise<void> {
    const outcome = await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(VipPayment, {
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment || payment.status === VipPaymentStatus.REFUNDED) {
        return null;
      }
      if (payment.status !== VipPaymentStatus.PAID) return 'unpaid' as const;

      payment.status = VipPaymentStatus.REFUNDED;
      payment.failureReason = reason;
      await em.save(payment);

      const now = new Date();
      const player = await em.findOne(Player, {
        where: { id: payment.playerId },
        lock: { mode: 'pessimistic_write' },
      });
      const before = player?.vipUntil ?? null;
      if (
        player?.vipUntil &&
        isVipActive(player, now) &&
        !isVipLifetime(player)
      ) {
        const rolledBack = addMonths(player.vipUntil, -VIP_PERIOD_MONTHS);
        player.vipUntil = rolledBack > now ? rolledBack : now;
        await em.save(player);
      }

      const subscriptions = em.getRepository(VipSubscription);
      const subscription = await subscriptions.findOne({
        where: { playerId: payment.playerId },
        lock: { mode: 'pessimistic_write' },
      });
      // An old page whose regular payment was already replaced feeds nothing.
      const feeds =
        !!subscription &&
        (payment.kind === VipPaymentKind.RENEWAL ||
          subscription.provider !== VipProvider.WAYFORPAY ||
          subscription.regularRef === payment.invoiceId);
      let suspend: string | null = null;
      if (subscription && feeds) {
        if (
          subscription.provider === VipProvider.WAYFORPAY &&
          subscription.regularRef &&
          subscription.autoRenew
        ) {
          suspend = subscription.regularRef;
        }
        subscription.autoRenew = false;
        subscription.nextChargeAt = null;
        subscription.renewalClaimedAt = null;
        await subscriptions.save(subscription);
      }

      this.logger.warn(
        `VIP ${payment.reference} (${payment.kind}) refunded (${reason}, ${invoiceId}): player ${payment.playerId} ` +
          `VIP until ${before?.toISOString() ?? 'none'} → ${player?.vipUntil?.toISOString() ?? 'none'}` +
          `${player ? '' : ' (account deleted)'}, auto-renew ${feeds ? 'off' : 'untouched'}`,
      );
      return { playerId: payment.playerId, suspend, found: !!player };
    });
    if (outcome === 'unpaid') {
      await this.settleFailure(paymentId, {
        invoiceId,
        status: 'reversed',
        failureReason: reason,
      });
      return;
    }
    if (!outcome) return;
    if (outcome.suspend) {
      await this.stopRegular(outcome.playerId, outcome.suspend, 'SUSPEND');
    }
    if (outcome.found) this.chatAccess.changed([outcome.playerId]);
  }

  /**
   * WayForPay refunded one of its own monthly charges. The credited month is
   * the RENEWAL row of that charge: same subscription, paid within a day of
   * the refunded order's creation. Found → {@link settleRefund}. Not found
   * (never credited, or the order carries no date) → auto-renewal still stops,
   * and admins are told to check the VIP time by hand.
   */
  private async refundRegularCharge(
    subscription: VipSubscription,
    tx: TWfpTransaction,
  ): Promise<void> {
    const reason = `WayForPay: ${tx.transactionStatus ?? 'Refunded'}`;
    const chargedAt = wfpTime(tx.createdDate) ?? wfpTime(tx.processingDate);
    const regularRef = subscription.regularRef;
    if (chargedAt && regularRef) {
      const rows = await this.dataSource.getRepository(VipPayment).find({
        where: {
          playerId: subscription.playerId,
          kind: VipPaymentKind.RENEWAL,
          status: In([VipPaymentStatus.PAID, VipPaymentStatus.REFUNDED]),
          paidAt: Between(
            new Date(chargedAt.getTime() - WFP_SAME_CHARGE_MS),
            new Date(chargedAt.getTime() + WFP_SAME_CHARGE_MS),
          ),
        },
      });
      const distance = (r: VipPayment) =>
        Math.abs((r.paidAt?.getTime() ?? 0) - chargedAt.getTime());
      const charge = rows
        .filter((r) => r.invoiceId?.startsWith(`${regularRef}@`))
        .sort((a, b) => distance(a) - distance(b))[0];
      if (charge) {
        await this.settleRefund(charge.id, tx.orderReference, reason);
        return;
      }
    }
    const wasOn = subscription.autoRenew;
    await this.dataSource
      .getRepository(VipSubscription)
      .update(
        { id: subscription.id },
        { autoRenew: false, nextChargeAt: null, renewalClaimedAt: null },
      );
    if (wasOn && regularRef) {
      await this.stopRegular(subscription.playerId, regularRef, 'SUSPEND');
    }
    this.logger.error(
      `VIP: WayForPay charge ${tx.orderReference} of ${subscription.playerId} was refunded (${reason}) but matches ` +
        'no credited month — auto-renewal stopped; check the VIP time manually',
    );
  }

  private async settleWayForPaySuccess(
    paymentId: string,
    tx: TWfpTransaction,
  ): Promise<void> {
    const paid = wfpAmountToKopecks(tx.amount);
    const settled = await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(VipPayment, {
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment || payment.status === VipPaymentStatus.PAID) return null;
      if (
        (paid !== null && paid !== payment.amount) ||
        (tx.currency && tx.currency !== 'UAH')
      ) {
        // Paid, but not what was ordered: never silently swallow money.
        this.logger.error(
          `VIP ${payment.reference}: WayForPay order ${tx.orderReference} paid ${String(tx.amount)} ${tx.currency ?? ''}, ` +
            `expected ${payment.amount} kopecks UAH — not credited, review manually`,
        );
        return null;
      }

      const now = new Date();
      payment.status = VipPaymentStatus.PAID;
      payment.paidAt = now;
      payment.failureReason = null;
      await em.save(payment);

      const player = await this.lockPlayer(em, payment.playerId);
      player.vipUntil = addMonths(
        this.periodAnchor(player, now),
        VIP_PERIOD_MONTHS,
      );
      await em.save(player);

      const subscriptions = em.getRepository(VipSubscription);
      const subscription =
        (await subscriptions.findOne({
          where: { playerId: payment.playerId },
          lock: { mode: 'pessimistic_write' },
        })) ??
        subscriptions.create({
          playerId: payment.playerId,
          walletId: payment.playerId,
          failedAttempts: 0,
          discountPercent: 0,
        });
      const replaced =
        subscription.provider === VipProvider.WAYFORPAY &&
        subscription.regularRef &&
        subscription.regularRef !== payment.invoiceId
          ? subscription.regularRef
          : null;
      Object.assign(subscription, {
        provider: VipProvider.WAYFORPAY,
        regularRef: payment.invoiceId,
        cardToken: tx.recToken ?? null,
        maskedPan: tx.cardPan ?? subscription.maskedPan ?? null,
        autoRenew: true,
        failedAttempts: 0,
        renewalClaimedAt: null,
        lastChargeAt: wfpTime(tx.processingDate) ?? now,
        nextChargeAt: addHours(player.vipUntil, -VIP_RENEWAL_LEAD_HOURS),
      });
      await subscriptions.save(subscription);

      this.logger.log(
        `VIP ${payment.reference} paid through WayForPay: player ${player.id} VIP until ` +
          `${player.vipUntil.toISOString()}, regular payment ${payment.invoiceId}`,
      );
      return { playerId: player.id, replaced };
    });
    if (!settled) return;
    // A newer subscription replaces an older (suspended) one: never charge both.
    if (settled.replaced) {
      await this.removeRegular(settled.playerId, settled.replaced);
    }
    this.chatAccess.changed([settled.playerId]);
  }

  /**
   * Reads a WayForPay subscription's regularApi STATUS and credits a charge
   * newer than the last one credited (one `vip_payment` row per charge, keyed
   * `<regularRef>@<paid at>`). VIP then lasts a month more, and at least until
   * a little past the next scheduled charge. `due` = the scheduler's own check:
   * no new charge yet is re-checked, and given up only once VIP is long over.
   */
  private async syncRegular(
    subscription: VipSubscription,
    due: boolean,
  ): Promise<void> {
    const wfp = this.wfp();
    if (!wfp || !subscription.regularRef) return;
    const regularRef = subscription.regularRef;
    const r = await wfp.regular('STATUS', regularRef);
    const code = Number(r.reasonCode);
    if (code !== WFP_REGULAR_OK && !WFP_REGULAR_GONE.includes(code)) {
      throw new Error(
        `regularApi STATUS ${code} ${String(r.reason ?? '')}`.trim(),
      );
    }
    const now = new Date();
    const paidAt = wfpTime(r.lastPayedDate);
    const approved = /^(approved|success|ok)/i.test(r.lastPayedStatus ?? '');
    if (code === WFP_REGULAR_OK && paidAt && approved) {
      const credited = await this.creditRegularCharge(
        subscription.id,
        regularRef,
        paidAt,
        wfpAmountToKopecks(r.amount),
        wfpTime(r.nextPaymentDate),
      );
      if (credited) {
        this.chatAccess.changed([subscription.playerId]);
        return;
      }
    }
    if (!due) return;

    const repo = this.dataSource.getRepository(VipSubscription);
    const state = (r.status ?? '').toLowerCase();
    if (
      WFP_REGULAR_GONE.includes(code) ||
      ['removed', 'completed', 'suspended'].includes(state)
    ) {
      // Cancelled at WayForPay itself (its e-mail link or support): VIP runs out.
      await repo.update(
        { id: subscription.id },
        { autoRenew: false, nextChargeAt: null, renewalClaimedAt: null },
      );
      this.logger.warn(
        `VIP auto-renewal for ${subscription.playerId} off: WayForPay regular payment is ${state || code}`,
      );
      return;
    }
    const player = await this.findPlayer(subscription.playerId);
    const giveUpAt = addHours(player.vipUntil ?? now, VIP_WFP_GIVE_UP_HOURS);
    if (now < giveUpAt) {
      await repo.update(
        { id: subscription.id },
        {
          nextChargeAt: addHours(now, VIP_WFP_RECHECK_HOURS),
          renewalClaimedAt: null,
        },
      );
      return;
    }
    await repo.update(
      { id: subscription.id },
      { autoRenew: false, nextChargeAt: null, renewalClaimedAt: null },
    );
    await this.removeRegular(subscription.playerId, regularRef);
    this.logger.warn(
      `VIP auto-renewal for ${subscription.playerId} given up: no WayForPay charge since ` +
        `${subscription.lastChargeAt?.toISOString() ?? 'the first month'} (last: ${r.lastPayedStatus ?? 'none'})`,
    );
  }

  /** One WayForPay monthly charge, credited once. Returns false when it was already counted. */
  private async creditRegularCharge(
    subscriptionId: string,
    regularRef: string,
    paidAt: Date,
    amount: number | null,
    nextPaymentAt: Date | null,
  ): Promise<boolean> {
    const chargeKey = `${regularRef}@${Math.floor(paidAt.getTime() / 1000)}`;
    const reference = await this.generateReference();
    try {
      return await this.dataSource.transaction(async (em) => {
        const subscription = await em.findOne(VipSubscription, {
          where: { id: subscriptionId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!subscription) return false;
        const last = subscription.lastChargeAt?.getTime() ?? 0;
        if (paidAt.getTime() <= last + WFP_SAME_CHARGE_MS) return false;
        if (await em.findOne(VipPayment, { where: { invoiceId: chargeKey } })) {
          return false;
        }

        const now = new Date();
        const player = await this.lockPlayer(em, subscription.playerId);
        let until = addMonths(
          this.periodAnchor(player, now),
          VIP_PERIOD_MONTHS,
        );
        if (nextPaymentAt) {
          const graced = addHours(nextPaymentAt, VIP_WFP_CHARGE_GRACE_HOURS);
          if (graced > until) until = graced;
        }
        if (!isVipLifetime(player)) {
          player.vipUntil = until;
          await em.save(player);
        }

        await em.save(
          em.create(VipPayment, {
            playerId: subscription.playerId,
            reference,
            kind: VipPaymentKind.RENEWAL,
            status: VipPaymentStatus.PAID,
            amount: amount ?? vipMonthlyPrice(subscription.discountPercent),
            invoiceId: chargeKey,
            pageUrl: null,
            paidAt,
          }),
        );

        subscription.lastChargeAt = paidAt;
        subscription.failedAttempts = 0;
        subscription.renewalClaimedAt = null;
        subscription.nextChargeAt =
          subscription.autoRenew && player.vipUntil
            ? addHours(player.vipUntil, -VIP_RENEWAL_LEAD_HOURS)
            : null;
        await em.save(subscription);
        this.logger.log(
          `VIP renewal ${reference} (WayForPay ${chargeKey}) credited: player ${player.id} ` +
            `VIP until ${player.vipUntil?.toISOString()}`,
        );
        return true;
      });
    } catch (err) {
      // A parallel callback inserted the same charge first (unique invoiceId).
      if ((err as { code?: string })?.code === '23505') return false;
      throw err;
    }
  }

  /** The subscription a WayForPay charge we never issued belongs to: its regular payment, or its card token. */
  private async findRegularSubscription(
    tx: TWfpTransaction,
  ): Promise<VipSubscription | null> {
    // WayForPay's own charges may carry the subscription's order reference,
    // a longer reference starting with it, or only the card token.
    const byRef =
      '"s"."regularRef" = :ref OR left(:ref, length("s"."regularRef")) = "s"."regularRef"';
    return this.dataSource
      .getRepository(VipSubscription)
      .createQueryBuilder('s')
      .where('"s"."provider" = :provider', {
        provider: VipProvider.WAYFORPAY,
      })
      .andWhere('"s"."regularRef" IS NOT NULL')
      .andWhere(
        tx.recToken ? `(${byRef} OR "s"."cardToken" = :token)` : `(${byRef})`,
        { ref: tx.orderReference, token: tx.recToken ?? '' },
      )
      .orderBy('"s"."updatedAt"', 'DESC')
      .getOne();
  }

  /** SUSPEND / RESUME at WayForPay; a dead subscription means subscribing again. */
  private async regularCommand(
    regularRef: string,
    command: 'SUSPEND' | 'RESUME',
  ): Promise<void> {
    const wfp = this.wfp();
    if (!wfp) {
      throw new ServiceUnavailableException({
        error: 'payments_unavailable',
        message: 'Оплата тимчасово недоступна — спробуйте пізніше',
      });
    }
    let code: number;
    try {
      code = Number((await wfp.regular(command, regularRef)).reasonCode);
    } catch (err) {
      this.logger.error(
        `VIP: regularApi ${command} ${regularRef} failed`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new BadGatewayException({
        error: 'payment_provider',
        message: 'Платіжний сервіс не відповів — спробуйте за хвилину',
      });
    }
    if (code === WFP_REGULAR_OK) return;
    // Already gone at WayForPay: nothing left to suspend; resuming needs a new subscription.
    if (WFP_REGULAR_GONE.includes(code) && command === 'SUSPEND') return;
    if (WFP_REGULAR_GONE.includes(code)) {
      throw new BadRequestException({
        error: 'vip_no_saved_card',
        message: 'Підписку завершено — оформіть її ще раз',
      });
    }
    this.logger.error(
      `VIP: regularApi ${command} ${regularRef} refused: ${code}`,
    );
    throw new BadGatewayException({
      error: 'payment_provider',
      message: 'Платіжний сервіс не відповів — спробуйте за хвилину',
    });
  }

  /** Stops a WayForPay regular payment for good; failures are logged, never thrown. */
  private removeRegular(playerId: string, regularRef: string): Promise<void> {
    return this.stopRegular(playerId, regularRef, 'REMOVE');
  }

  /** REMOVE (for good) or SUSPEND a WayForPay regular payment; failures are logged, never thrown. */
  private async stopRegular(
    playerId: string,
    regularRef: string,
    command: 'REMOVE' | 'SUSPEND',
  ): Promise<void> {
    const wfp = this.wfp();
    if (!wfp) return;
    try {
      const r = await wfp.regular(command, regularRef);
      const code = Number(r.reasonCode);
      if (code !== WFP_REGULAR_OK && !WFP_REGULAR_GONE.includes(code)) {
        throw new Error(`${code} ${String(r.reason ?? '')}`);
      }
    } catch (err) {
      this.logger.error(
        `VIP: regularApi ${command} of WayForPay regular payment ${regularRef} of ${playerId} failed — ` +
          `${command === 'REMOVE' ? 'remove' : 'suspend'} it in the WayForPay cabinet: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── account deletion ─────────────────────────────────────────────────────

  /**
   * Account deletion (`DELETE /players/:id`): no card of a deleted player may
   * ever be charged again, so this runs before anything is deleted.
   * - A WayForPay regular payment (active or suspended) is REMOVEd at
   *   WayForPay. WayForPay charges it on its own, so if it cannot be removed
   *   — WayForPay unreachable, a refusal, or credentials gone — this throws
   *   (502 / 503) and the deletion is aborted with nothing changed; the
   *   player can simply try again.
   * - A Monobank card token is only ever charged by us, and the subscription
   *   row goes with the account, so auto-renewal is switched off here and the
   *   token deleted at Monobank best effort.
   */
  async stopPaymentsForAccountDeletion(playerId: string): Promise<void> {
    const repo = this.dataSource.getRepository(VipSubscription);
    const subscription = await repo.findOne({ where: { playerId } });
    if (!subscription) return;

    if (
      subscription.provider === VipProvider.WAYFORPAY &&
      subscription.regularRef
    ) {
      await this.removeRegularOrThrow(playerId, subscription.regularRef);
    }
    if (
      subscription.cardToken &&
      subscription.provider !== VipProvider.WAYFORPAY
    ) {
      await this.forgetMonoCard(playerId, subscription.cardToken);
    }
    await repo.update(
      { id: subscription.id },
      {
        autoRenew: false,
        nextChargeAt: null,
        renewalClaimedAt: null,
        cardToken: null,
      },
    );
    this.logger.log(
      `VIP: payments of ${playerId} stopped before account deletion ` +
        `(${subscription.provider}${subscription.regularRef ? `, regular payment ${subscription.regularRef} removed` : ''})`,
    );
  }

  /** REMOVE that must succeed (account deletion): any failure aborts the caller. */
  private async removeRegularOrThrow(
    playerId: string,
    regularRef: string,
  ): Promise<void> {
    const refused = {
      error: 'payment_provider',
      message:
        'Не вдалося скасувати автоплатіж VIP у платіжному сервісі — акаунт не видалено. Спробуйте за кілька хвилин',
    };
    const wfp = this.wfp();
    if (!wfp) {
      this.logger.error(
        `VIP: account ${playerId} has WayForPay regular payment ${regularRef}, but WayForPay is not configured — deletion refused`,
      );
      throw new ServiceUnavailableException(refused);
    }
    let code: number;
    try {
      code = Number((await wfp.regular('REMOVE', regularRef)).reasonCode);
    } catch (err) {
      this.logger.error(
        `VIP: regularApi REMOVE ${regularRef} before deleting ${playerId} failed — deletion refused: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadGatewayException(refused);
    }
    if (code === WFP_REGULAR_OK || WFP_REGULAR_GONE.includes(code)) return;
    this.logger.error(
      `VIP: regularApi REMOVE ${regularRef} before deleting ${playerId} refused: ${code} — deletion refused`,
    );
    throw new BadGatewayException(refused);
  }

  /** Lifetime grant or revoke: the player's WayForPay regular payment must never charge again. */
  private async removeRegularOf(playerId: string): Promise<void> {
    const subscription = await this.dataSource
      .getRepository(VipSubscription)
      .findOne({ where: { playerId } });
    if (
      subscription?.provider === VipProvider.WAYFORPAY &&
      subscription.regularRef
    ) {
      await this.removeRegular(playerId, subscription.regularRef);
    }
  }

  /**
   * A returning payer polls `/vip/me`: when a WayForPay page is still pending,
   * ask WayForPay directly, so a late callback never leaves a paid month
   * uncredited. Returns true when something was settled.
   */
  private async refreshPendingWayForPay(playerId: string): Promise<boolean> {
    const wfp = this.wfp();
    if (!wfp) return false;
    const payment = await this.dataSource.getRepository(VipPayment).findOne({
      where: {
        playerId,
        kind: VipPaymentKind.INITIAL,
        status: VipPaymentStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });
    if (!payment?.invoiceId?.startsWith(`${payment.reference}_`)) return false;
    try {
      const tx = await wfp.checkStatus(payment.invoiceId);
      if (tx.transactionStatus !== 'Approved') return false;
      await this.settleWayForPaySuccess(payment.id, tx);
      return true;
    } catch (err) {
      this.logger.warn(
        `VIP ${payment.reference}: WayForPay CHECK_STATUS failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  // ── the switch to WayForPay ──────────────────────────────────────────────

  /**
   * The switch to WayForPay (owner 2026-10-14): every Monobank subscription is
   * cancelled once — auto-renewal off and the saved card forgotten, so nothing
   * is charged on Monobank again and it cannot be switched back on. VIP already
   * paid for runs to its end. Players who had paid get
   * {@link VIP_SWITCH_DISCOUNT_PERCENT}% off every future month and the
   * one-time pop-up. Runs at start once WayForPay is configured; a row is
   * claimed by a conditional update, so a second run (or process) skips it.
   */
  async retireMonoSubscriptions(): Promise<number> {
    if (!this.wfp()) return 0;
    const repo = this.dataSource.getRepository(VipSubscription);
    const rows = await repo.find({
      where: { provider: VipProvider.MONO, paymentSwitchedAt: IsNull() },
    });
    let retired = 0;
    for (const row of rows) {
      const paid = await this.dataSource.getRepository(VipPayment).count({
        where: { playerId: row.playerId, status: VipPaymentStatus.PAID },
      });
      const claimed = await repo
        .createQueryBuilder()
        .update(VipSubscription)
        .set({
          autoRenew: false,
          nextChargeAt: null,
          renewalClaimedAt: null,
          cardToken: null,
          paymentSwitchedAt: new Date(),
          discountPercent:
            paid > 0
              ? Math.max(row.discountPercent, VIP_SWITCH_DISCOUNT_PERCENT)
              : row.discountPercent,
        })
        .where('id = :id', { id: row.id })
        .andWhere('"paymentSwitchedAt" IS NULL')
        .execute();
      if (!claimed.affected) continue;
      retired += 1;
      if (row.cardToken) await this.forgetMonoCard(row.playerId, row.cardToken);
      this.logger.log(
        `VIP: Monobank subscription of ${row.playerId} retired (auto-renew was ${row.autoRenew ? 'on' : 'off'}, ` +
          `${paid} paid payment(s)${paid > 0 ? `, ${VIP_SWITCH_DISCOUNT_PERCENT}% off from now on` : ''})`,
      );
    }
    if (retired > 0) {
      this.logger.log(
        `VIP: ${retired} Monobank subscription(s) retired by the switch to WayForPay`,
      );
    }
    return retired;
  }

  /** Deletes the Monobank card token too, best effort: the column is cleared either way. */
  private async forgetMonoCard(
    playerId: string,
    cardToken: string,
  ): Promise<void> {
    if (!this.config.getEnvConfig().MONOBANK_MERCHANT_TOKEN) return;
    try {
      await this.acquiring.deleteCardToken(cardToken);
    } catch (err) {
      this.logger.warn(
        `VIP: Monobank card token of ${playerId} not deleted (${err instanceof Error ? err.message : String(err)}); ` +
          'it is forgotten here and never charged again',
      );
    }
  }

  /**
   * The "payment method changed" pop-up: to a player whose paid VIP lost its
   * Monobank auto-renewal at the switch (while that VIP still runs and they have
   * not subscribed through WayForPay yet), and to admins — until read.
   */
  private paymentNotice(
    player: Player,
    subscription: VipSubscription | null,
    isAdmin: boolean,
    seenAt: Date | null,
  ): VipPaymentNoticeDto | null {
    if (!this.wfp() || seenAt) return null;
    const affected =
      !!subscription?.paymentSwitchedAt &&
      subscription.discountPercent > 0 &&
      isVipActive(player) &&
      !isVipLifetime(player) &&
      !(
        subscription.provider === VipProvider.WAYFORPAY &&
        subscription.autoRenew
      );
    if (!affected && !isAdmin) return null;
    return {
      vipUntil: affected ? player.vipUntil : null,
      discountPercent: VIP_SWITCH_DISCOUNT_PERCENT,
      priceKopecks: vipMonthlyPrice(VIP_SWITCH_DISCOUNT_PERCENT),
      fullPriceKopecks: VIP_MONTHLY_PRICE_KOPECKS,
      adminPreview: !affected,
    };
  }

  /** Read on its own: the column is `select: false`, so no player payload ever carries it. */
  private async noticeSeenAt(playerId: string): Promise<Date | null> {
    const row = await this.dataSource
      .getRepository(Player)
      .createQueryBuilder('p')
      .select('"p"."vipPaymentNoticeSeenAt"', 'seenAt')
      .where('"p"."id" = :playerId', { playerId })
      .getRawOne<{ seenAt: Date | null }>();
    return row?.seenAt ?? null;
  }

  /** After a payment settled mid-request: the VIP columns as they are now. */
  private async reloadVipFields(player: Player): Promise<void> {
    const fresh = await this.findPlayer(player.id);
    player.vipUntil = fresh.vipUntil;
    player.vipFrameColor = fresh.vipFrameColor;
  }

  // ── renewals (scheduler) ─────────────────────────────────────────────────

  /**
   * Every subscription whose renewal is due. Monobank ones charge the saved
   * card; WayForPay ones read whether WayForPay's own monthly charge went
   * through. Safe to run concurrently.
   */
  async runDueRenewals(now = new Date()): Promise<void> {
    const claimed = await this.claimDueRenewals(now);
    for (const subscription of claimed) {
      try {
        if (subscription.provider === VipProvider.WAYFORPAY) {
          await this.syncRegular(subscription, true);
        } else {
          await this.chargeRenewal(subscription);
        }
      } catch (err) {
        this.logger.error(
          `VIP renewal for player ${subscription.playerId} crashed; the claim expires and the next tick retries`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
  }

  /**
   * Atomically marks due subscriptions as claimed, so two ticks (or two
   * processes) never charge the same card for the same period.
   */
  private async claimDueRenewals(now: Date): Promise<VipSubscription[]> {
    const repo = this.dataSource.getRepository(VipSubscription);
    const staleClaim = new Date(
      now.getTime() - VIP_RENEWAL_CLAIM_TTL_MINUTES * 60 * 1000,
    );
    const due = await repo.find({
      select: { id: true },
      where: [
        {
          autoRenew: true,
          nextChargeAt: LessThanOrEqual(now),
          renewalClaimedAt: IsNull(),
        },
        {
          autoRenew: true,
          nextChargeAt: LessThanOrEqual(now),
          renewalClaimedAt: LessThan(staleClaim),
        },
      ],
      take: RENEWAL_BATCH,
    });
    if (!due.length) return [];

    const result = await repo
      .createQueryBuilder()
      .update(VipSubscription)
      .set({ renewalClaimedAt: now })
      .where('id IN (:...ids)', { ids: due.map((d) => d.id) })
      .andWhere('"autoRenew" = true')
      .andWhere('("renewalClaimedAt" IS NULL OR "renewalClaimedAt" < :stale)', {
        stale: staleClaim,
      })
      .returning('*')
      .execute();
    return (result.raw as VipSubscription[]).filter((s) =>
      s.provider === VipProvider.WAYFORPAY ? !!s.regularRef : !!s.cardToken,
    );
  }

  private async chargeRenewal(subscription: VipSubscription): Promise<void> {
    const payments = this.dataSource.getRepository(VipPayment);

    // A renewal still pending from an earlier claim (webhook lost?): ask
    // Monobank for its outcome instead of charging the card a second time.
    const inFlight = await payments.findOne({
      where: {
        playerId: subscription.playerId,
        kind: VipPaymentKind.RENEWAL,
        status: VipPaymentStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });
    if (inFlight?.invoiceId) {
      const status = await this.fetchInvoice(inFlight.invoiceId);
      if (status) await this.applyInvoiceCallback(status);
      return;
    }

    if (!subscription.cardToken || !subscription.webHookUrl || this.wfp()) {
      this.logger.error(
        `VIP renewal for ${subscription.playerId}: ${this.wfp() ? 'Monobank is retired' : 'no card token or webhook URL'} — switching auto-renewal off`,
      );
      await this.dataSource
        .getRepository(VipSubscription)
        .update(
          { id: subscription.id },
          { autoRenew: false, nextChargeAt: null, renewalClaimedAt: null },
        );
      return;
    }

    let payment =
      inFlight ??
      payments.create({
        playerId: subscription.playerId,
        reference: await this.generateReference(),
        kind: VipPaymentKind.RENEWAL,
        status: VipPaymentStatus.PENDING,
        amount: vipMonthlyPrice(subscription.discountPercent ?? 0),
        invoiceId: null,
        pageUrl: null,
      });
    payment = await payments.save(payment);

    try {
      const result = await this.acquiring.walletPayment({
        cardToken: subscription.cardToken,
        amount: payment.amount,
        reference: payment.reference,
        destination: VIP_RENEWAL_PRODUCT_NAME,
        webHookUrl: subscription.webHookUrl,
      });
      payment.invoiceId = result.invoiceId;
      payment = await payments.save(payment);
      this.logger.log(
        `VIP renewal ${payment.reference} for ${subscription.playerId}: invoice ${result.invoiceId} (${result.status ?? 'sent'})`,
      );
      // The webhook settles it; apply a final answer right away when there is one.
      const parsed = InvoiceCallbackSchema.safeParse(result);
      if (
        parsed.success &&
        (parsed.data.status === 'success' ||
          FAILED_INVOICE_STATUSES.has(parsed.data.status))
      ) {
        await this.applyInvoiceCallback(parsed.data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.settleFailure(payment.id, {
        invoiceId: payment.invoiceId ?? '',
        status: 'failure',
        failureReason: `wallet/payment request failed: ${message}`.slice(
          0,
          250,
        ),
      });
    }
  }

  /** A failed renewal: retry later, and give up after the last attempt. */
  private async recordRenewalFailure(
    em: EntityManager,
    playerId: string,
  ): Promise<void> {
    const repo = em.getRepository(VipSubscription);
    const subscription = await repo.findOne({
      where: { playerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!subscription) return;
    subscription.failedAttempts += 1;
    subscription.renewalClaimedAt = null;
    if (subscription.failedAttempts >= VIP_RENEWAL_MAX_ATTEMPTS) {
      subscription.autoRenew = false;
      subscription.nextChargeAt = null;
      this.logger.warn(
        `VIP auto-renewal for ${playerId} switched off after ${subscription.failedAttempts} failed charges`,
      );
    } else {
      subscription.nextChargeAt = addHours(new Date(), VIP_RENEWAL_RETRY_HOURS);
    }
    await repo.save(subscription);
  }

  /** After an admin grant, the next charge moves to the new end of the period. */
  private async rescheduleRenewal(
    em: EntityManager,
    player: Player,
  ): Promise<void> {
    if (!player.vipUntil) return;
    await em
      .getRepository(VipSubscription)
      .update(
        { playerId: player.id, autoRenew: true },
        { nextChargeAt: addHours(player.vipUntil, -VIP_RENEWAL_LEAD_HOURS) },
      );
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** WayForPay when it is configured (it then takes every new payment), else null. */
  private wfp(): WayForPayService | null {
    return this.wayforpay?.isConfigured() ? this.wayforpay : null;
  }

  /** Something to renew with: a WayForPay regular payment, or a Monobank card while Monobank still renews. */
  private canResume(subscription: VipSubscription | null): boolean {
    if (!subscription) return false;
    if (subscription.provider === VipProvider.WAYFORPAY) {
      return !!subscription.regularRef;
    }
    return !!subscription.cardToken && !this.wfp();
  }

  private countPendingCheckouts(playerId: string): Promise<number> {
    return this.dataSource.getRepository(VipPayment).count({
      where: {
        playerId,
        kind: VipPaymentKind.INITIAL,
        status: VipPaymentStatus.PENDING,
        createdAt: MoreThan(
          new Date(Date.now() - VIP_INVOICE_VALIDITY_SEC * 1000),
        ),
      },
    });
  }

  private toAdminResult(player: Player): AdminVipResultDto {
    return {
      playerId: player.id,
      lifetime: isVipLifetime(player),
      ...toVipPublicFields(player),
    };
  }

  /** A new period starts where the current one ends, or now when VIP has lapsed. */
  private periodAnchor(player: Player, now = new Date()): Date {
    return isVipActive(player, now) && player.vipUntil ? player.vipUntil : now;
  }

  private async playerExists(playerId: string): Promise<boolean> {
    return (
      (await this.dataSource
        .getRepository(Player)
        .count({ where: { id: playerId } })) > 0
    );
  }

  private async findPlayer(playerId: string): Promise<Player> {
    const player = await this.dataSource
      .getRepository(Player)
      .findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Гравця не знайдено');
    return player;
  }

  private async lockPlayer(
    em: EntityManager,
    playerId: string,
  ): Promise<Player> {
    const player = await em.findOne(Player, {
      where: { id: playerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!player) throw new NotFoundException('Гравця не знайдено');
    return player;
  }

  private async fetchInvoice(
    invoiceId: string,
  ): Promise<TInvoiceCallbackPayload | null> {
    try {
      const parsed = InvoiceCallbackSchema.safeParse(
        await this.acquiring.getInvoiceStatus(invoiceId),
      );
      return parsed.success ? parsed.data : null;
    } catch (err) {
      this.logger.error(
        `VIP: invoice status request for ${invoiceId} failed`,
        err instanceof Error ? err.stack : undefined,
      );
      return null;
    }
  }

  private async generateReference(): Promise<string> {
    const repo = this.dataSource.getRepository(VipPayment);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reference = generatePaymentReference(VIP_REFERENCE_PREFIX);
      if (!(await repo.count({ where: { reference } }))) return reference;
    }
    throw new InternalServerErrorException(
      'Failed to generate a VIP payment reference',
    );
  }

  /** Back to the profile after paying; `?vip=return` makes the SPA refresh VIP status. */
  private redirectUrlFrom(headers: TRequestHeaders): string {
    const allowed = (this.config.getEnvConfig().CORS_ORIGINS ?? '').split(',');
    const spa = spaOriginFrom(headers, allowed);
    if (!spa) {
      throw new InternalServerErrorException(
        'Cannot derive a SPA origin to redirect the payer to after payment — check CORS_ORIGINS',
      );
    }
    return `${spa}/me?vip=return`;
  }
}
