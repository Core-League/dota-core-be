import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  LessThan,
  LessThanOrEqual,
  MoreThan,
} from 'typeorm';
import { ConfigConnectorService } from '../connectors/config/config-connector.service';
import { MonobankAcquiringService } from '../connectors/monobank-acquiring/monobank-acquiring.service';
import {
  InvoiceCallbackSchema,
  type TInvoiceCallbackPayload,
} from '../connectors/monobank-acquiring/monobank-acquiring.types';
import { Player } from '../players/player.entity';
import { acquiringWebHookUrlFrom } from '../tournaments/acquiring-urls.util';
import {
  spaOriginFrom,
  type TRequestHeaders,
} from '../tournaments/request-origin.util';
import { generatePaymentReference } from '../tournaments/tournament-team-payment.util';
import { AdminVipResultDto, VipCheckoutDto, VipStatusDto } from './dto/vip.dto';
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
  VipPaymentKind,
  VipPaymentStatus,
  isVipFrameColor,
} from './vip.constants';
import {
  addHours,
  addMonths,
  isVipActive,
  isVipLifetime,
  toVipPublicFields,
} from './vip.utils';

/** Renewals charged per scheduler tick; the rest wait for the next one. */
const RENEWAL_BATCH = 20;

/** Monobank statuses that end an invoice without money. */
const FAILED_INVOICE_STATUSES = new Set(['failure', 'expired', 'reversed']);

/**
 * VIP status: 250 ₴ a month through Monobank acquiring, or granted by an admin.
 *
 * Payment rail (Monobank's recommendation for recurring payments):
 * 1. The first invoice is created with `saveCardData { saveCard, walletId }`;
 *    the payer pays once on the Monobank page and the card is tokenized.
 * 2. Its callback carries `walletData.cardToken`; we keep it on
 *    `vip_subscription` and extend `player.vipUntil` by a month.
 * 3. {@link VipRenewalScheduler} charges the token (`wallet/payment`,
 *    `initiationKind: merchant`) shortly before `vipUntil`; every settled
 *    renewal extends VIP by another month.
 *
 * VIP itself is only `player.vipUntil`, so an admin grant and a payment are the
 * same thing to the rest of the app.
 */
@Injectable()
export class VipService {
  private readonly logger = new Logger(VipService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly acquiring: MonobankAcquiringService,
    private readonly config: ConfigConnectorService,
  ) {}

  // ── reads ────────────────────────────────────────────────────────────────

  async getStatus(playerId: string): Promise<VipStatusDto> {
    const player = await this.findPlayer(playerId);
    const [subscription, pending] = await Promise.all([
      this.dataSource
        .getRepository(VipSubscription)
        .findOne({ where: { playerId } }),
      this.dataSource.getRepository(VipPayment).count({
        where: {
          playerId,
          kind: VipPaymentKind.INITIAL,
          status: VipPaymentStatus.PENDING,
          createdAt: MoreThan(
            new Date(Date.now() - VIP_INVOICE_VALIDITY_SEC * 1000),
          ),
        },
      }),
    ]);
    return {
      ...toVipPublicFields(player),
      priceKopecks: VIP_MONTHLY_PRICE_KOPECKS,
      frameColors: [...VIP_FRAME_COLORS],
      autoRenew: !!subscription?.autoRenew,
      nextChargeAt: subscription?.autoRenew
        ? (subscription.nextChargeAt ?? null)
        : null,
      maskedPan: subscription?.maskedPan ?? null,
      hasSavedCard: !!subscription?.cardToken,
      paymentPending: pending > 0,
    };
  }

  // ── player mutations ─────────────────────────────────────────────────────

  /**
   * Creates the first-payment invoice (with card tokenization) and returns
   * the Monobank page to send the payer to. Refused while auto-renewal is
   * already on — the card is charged automatically then.
   */
  async checkout(
    playerId: string,
    headers: TRequestHeaders,
  ): Promise<VipCheckoutDto> {
    const buyer = await this.findPlayer(playerId);
    if (isVipLifetime(buyer)) {
      throw new ConflictException({
        error: 'vip_lifetime',
        message: 'У вас безстроковий VIP — оплата не потрібна',
      });
    }
    const subscriptions = this.dataSource.getRepository(VipSubscription);
    const existing = await subscriptions.findOne({ where: { playerId } });
    if (existing?.autoRenew && existing.cardToken) {
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
        amount: VIP_MONTHLY_PRICE_KOPECKS,
        invoiceId: null,
        pageUrl: null,
      }),
    );

    const env = this.config.getEnvConfig();
    if (!env.MONOBANK_MERCHANT_TOKEN) {
      this.logger.warn(
        `VIP ${payment.reference}: MONOBANK_MERCHANT_TOKEN is not configured — no invoice created`,
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
      destination: 'VIP-статус Core League — 1 місяць',
      redirectUrl,
      webHookUrl,
      validitySec: VIP_INVOICE_VALIDITY_SEC,
      saveCardWalletId: playerId,
    });
    payment.invoiceId = invoice.invoiceId;
    payment.pageUrl = invoice.pageUrl;
    payment = await payments.save(payment);

    return {
      pageUrl: payment.pageUrl,
      reference: payment.reference,
      amount: payment.amount,
    };
  }

  /** Stops future charges; VIP stays until `vipUntil`. */
  async cancelAutoRenew(playerId: string): Promise<VipStatusDto> {
    const repo = this.dataSource.getRepository(VipSubscription);
    const subscription = await repo.findOne({ where: { playerId } });
    if (subscription?.autoRenew) {
      subscription.autoRenew = false;
      subscription.nextChargeAt = null;
      await repo.save(subscription);
      this.logger.log(`VIP auto-renewal cancelled by player ${playerId}`);
    }
    return this.getStatus(playerId);
  }

  /** Switches auto-renewal back on with the saved card; only while VIP still lasts. */
  async resumeAutoRenew(playerId: string): Promise<VipStatusDto> {
    const player = await this.findPlayer(playerId);
    const repo = this.dataSource.getRepository(VipSubscription);
    const subscription = await repo.findOne({ where: { playerId } });
    if (!subscription?.cardToken) {
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
    subscription.autoRenew = true;
    subscription.failedAttempts = 0;
    subscription.nextChargeAt = addHours(
      player.vipUntil,
      -VIP_RENEWAL_LEAD_HOURS,
    );
    await repo.save(subscription);
    return this.getStatus(playerId);
  }

  async setFrameColor(
    playerId: string,
    color: string | null,
  ): Promise<VipStatusDto> {
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
    return this.getStatus(playerId);
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
    this.logger.log(
      `VIP granted by admin ${adminId} to ${playerId}: ` +
        `${grant.lifetime ? 'lifetime' : `+${months} mo`}, until ${player.vipUntil?.toISOString()}`,
    );
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
    this.logger.log(`VIP revoked by admin ${adminId} from ${playerId}`);
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
    } else if (FAILED_INVOICE_STATUSES.has(payload.status)) {
      await this.settleFailure(payment.id, payload);
    }
    return true;
  }

  private async settleSuccess(
    paymentId: string,
    payload: TInvoiceCallbackPayload,
  ): Promise<void> {
    // The token may be missing from a push; the invoice status always has it.
    const wallet =
      payload.walletData?.cardToken || !payload.invoiceId
        ? payload
        : await this.fetchInvoice(payload.invoiceId);

    await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(VipPayment, {
        where: { id: paymentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment || payment.status === VipPaymentStatus.PAID) return;

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
      if (payment.kind === VipPaymentKind.INITIAL && cardToken) {
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
    });
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
        // A refund of settled money: VIP is not taken back automatically.
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

  // ── renewals (scheduler) ─────────────────────────────────────────────────

  /** Charges every subscription whose renewal is due. Safe to run concurrently. */
  async runDueRenewals(now = new Date()): Promise<void> {
    const claimed = await this.claimDueRenewals(now);
    for (const subscription of claimed) {
      try {
        await this.chargeRenewal(subscription);
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
    return (result.raw as VipSubscription[]).filter((s) => !!s.cardToken);
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

    if (!subscription.cardToken || !subscription.webHookUrl) {
      this.logger.error(
        `VIP renewal for ${subscription.playerId}: no card token or webhook URL — switching auto-renewal off`,
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
        amount: VIP_MONTHLY_PRICE_KOPECKS,
        invoiceId: null,
        pageUrl: null,
      });
    payment = await payments.save(payment);

    try {
      const result = await this.acquiring.walletPayment({
        cardToken: subscription.cardToken,
        amount: payment.amount,
        reference: payment.reference,
        destination: 'Продовження VIP-статусу Core League — 1 місяць',
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
