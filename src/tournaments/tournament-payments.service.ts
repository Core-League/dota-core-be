import { VIP_TOURNAMENT_DISCOUNT_PERCENT } from '../vip/vip.constants';
import { isVipActive, vipEntryFee } from '../vip/vip.utils';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { Team } from '../teams/team.entity';
import { QualificationService } from '../qualification/qualification.service';
import { ConfigConnectorService } from '../connectors/config/config-connector.service';
import { MonobankAcquiringService } from '../connectors/monobank-acquiring/monobank-acquiring.service';
import type { TInvoiceCallbackPayload } from '../connectors/monobank-acquiring/monobank-acquiring.types';
import { WayForPayService } from '../connectors/wayforpay/wayforpay.service';
import {
  parseWfpOrderReference,
  wfpOrderReference,
  type TWfpTransaction,
} from '../connectors/wayforpay/wayforpay.types';
import { wfpToInvoiceCallback } from '../connectors/wayforpay/wayforpay-callback.mapper';
import { ENTRY_FEE_PRODUCT_NAME } from '../legal/legal.constants';
import {
  assertPaymentConsent,
  recordPaymentConsent,
  type TPaymentConsentInput,
} from '../legal/payment-consent';
import { PaymentConsentProduct } from '../legal/payment-consent.entity';
import { Tournament } from './tournaments.entity';
import { TournamentTeamPayment } from './tournament-team-payment.entity';
import { TournamentTeamPaymentRepository } from './tournament-team-payment.repository';
import { PaymentStatus } from './tournament-team-payment.model';
import { nextPaymentState } from './tournament-payment-transition';
import { TournamentPaymentSummaryDto } from './dto/tournament-payment-summary.dto';
import { TournamentPaymentIntentDto } from './dto/tournament-payment-intent.dto';
import { invoiceValiditySeconds } from './invoice-validity';
import type { TRequestHeaders } from './request-origin.util';
import {
  acquiringWebHookUrlFrom,
  tournamentRedirectUrlFrom,
  wayforpayServiceUrlFrom,
} from './acquiring-urls.util';
import {
  getRegistrationBlockReason,
  registrationBlockMessage,
} from './tournament-registration.util';
import { isJoinableStatus } from './tournaments.model';

@Injectable()
export class TournamentPaymentsService {
  private readonly logger = new Logger(TournamentPaymentsService.name);

  constructor(
    private readonly paymentRepo: TournamentTeamPaymentRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly acquiring: MonobankAcquiringService,
    private readonly config: ConfigConnectorService,
    private readonly qualification: QualificationService,
    /** Takes every new entry fee once configured (owner 2026-10-14); Monobank until then. */
    private readonly wayforpay?: WayForPayService,
  ) {}

  /** Per-team payment status for a tournament (used by admin overview and captain gating). */
  async getSummaries(
    tournamentId: string,
  ): Promise<TournamentPaymentSummaryDto[]> {
    const payments = await this.paymentRepo.findByTournamentId(tournamentId);
    return payments.map((p) => ({
      teamId: p.teamId,
      status: p.status,
      amountPaid: p.amountPaid,
    }));
  }

  /**
   * Forces a team's payment to PAID (offline/mis-commented payments). Creates the
   * record if the team never started a payment. Records the acting admin and note.
   */
  async markPaidByAdmin(
    tournamentId: string,
    teamId: string,
    adminPlayerId: string,
    note?: string,
  ): Promise<TournamentPaymentSummaryDto> {
    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Турнір не знайдено');

    const team = await this.dataSource
      .getRepository(Team)
      .findOne({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Команду не знайдено');

    let payment = await this.paymentRepo.findByTournamentAndTeam(
      tournamentId,
      teamId,
    );
    if (!payment) {
      const reference = await this.paymentRepo.generateUniqueReference();
      payment = this.paymentRepo.create({ tournamentId, teamId, reference });
    }

    payment.status = PaymentStatus.PAID;
    payment.paidAt = payment.paidAt ?? new Date();
    payment.markedByAdminId = adminPlayerId;
    if (note !== undefined) payment.note = note;
    if (!payment.amountPaid) {
      payment.amountPaid = payment.amountDue ?? tournament.entryFee ?? 0;
    }

    const saved = await this.paymentRepo.save(payment);
    return {
      teamId: saved.teamId,
      status: saved.status,
      amountPaid: saved.amountPaid,
    };
  }

  /**
   * Creates (or returns the existing) pending payment intent for the caller's
   * team on a fee'd tournament, so the captain can be redirected to the
   * provider-hosted payment page (WayForPay, or Monobank before the switch).
   *
   * Refused without consent to the current legal documents; every newly
   * minted page is logged in `payment_consent` in the same transaction as the
   * payment row (a reused live page is not logged again).
   */
  async createIntentForCaptain(
    tournamentId: string,
    playerId: string,
    headers: TRequestHeaders,
    consent: TPaymentConsentInput,
  ): Promise<TournamentPaymentIntentDto> {
    assertPaymentConsent(consent);
    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId }, relations: ['teams'] });
    if (!tournament) throw new NotFoundException('Турнір не знайдено');

    const entryFee = tournament.entryFee ?? 0;
    if (entryFee <= 0) {
      throw new BadRequestException('Турнір безкоштовний — оплата не потрібна');
    }

    /**
     * Не даємо стартувати оплату після закриття реєстрації: інакше капітан
     * сплатив би внесок і отримав відмову на приєднанні (повернення коштів).
     * Уже створені платежі лишаються доступними через getMyPayment.
     *
     * Статус перевіряємо разом із вікном дат: поза статусами, у яких можна
     * приєднатися, оплата так само призвела б до відмови на приєднанні.
     */
    if (!isJoinableStatus(tournament.tournamentStatus)) {
      throw new BadRequestException('Реєстрація на турнір закрита');
    }

    const blockReason = getRegistrationBlockReason(tournament);
    if (blockReason) {
      throw new BadRequestException(registrationBlockMessage(blockReason));
    }

    const team = await this.findCaptainTeam(playerId, [
      'captain',
      'mainPlayers',
      'reservedPlayers',
      'tournaments',
    ]);
    if (!team) {
      throw new ForbiddenException(
        'Тільки капітан команди може ініціювати оплату',
      );
    }

    /**
     * A successful payment registers the team automatically (see
     * `applyInvoiceCallback`), so every team-level refusal the join would
     * raise — unverified, no Dota team, bad roster, overlap, full — must
     * surface here, before money moves. Otherwise the captain pays and is
     * then refused, which is a refund we cannot issue from code.
     */
    this.qualification.assertTeamCanJoin(tournament, team);

    /**
     * The payment row is locked (`SELECT ... FOR UPDATE`) for the whole
     * transaction below — including the outbound call to Monobank — so a
     * second concurrent request for the same team (two open tabs, a double
     * click) blocks on the lock until the first commits, then re-reads the
     * row and finds the invoice already there instead of minting a second
     * one. Refunds are out of scope for this design, so an orphaned second
     * invoice is not a self-correcting annoyance — it is a real double
     * charge that only a manual cabinet operation can undo. Holding the
     * lock across the HTTP round-trip is the accepted tradeoff: a slower
     * first request rather than that failure mode.
     */
    const wfp = this.wayforpay?.isConfigured() ? this.wayforpay : null;
    const settled: { payment: TournamentTeamPayment | null } = {
      payment: null,
    };
    const intent = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TournamentTeamPayment);
      let payment = await repo.findOne({
        where: { tournamentId, teamId: team.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) {
        const reference = await this.paymentRepo.generateUniqueReference();
        payment = repo.create({
          tournamentId,
          teamId: team.id,
          reference,
          status: PaymentStatus.PENDING,
          amountPaid: 0,
        });
        payment = await repo.save(payment);
      }

      if (payment.status === PaymentStatus.PAID) {
        return this.toIntentDto(payment, entryFee);
      }

      // VIP perk: the captain who pays gets the entry fee 10% cheaper.
      const amountDue = vipEntryFee(entryFee, isVipActive(team.captain));

      if (wfp) {
        if (await this.reconcileForWayForPay(wfp, payment, amountDue)) {
          payment = await repo.save(payment);
          settled.payment = payment;
          return this.toIntentDto(payment, entryFee);
        }
        if (!payment.invoiceId || !payment.paymentPageUrl) {
          const expiresAt = new Date(
            Date.now() +
              invoiceValiditySeconds(
                new Date(),
                tournament.registrationEndsAt,
              ) *
                1000,
          );
          const orderReference = wfpOrderReference(
            payment.reference,
            expiresAt,
          );
          const page = await wfp.purchase({
            orderReference,
            amount: amountDue,
            productName: ENTRY_FEE_PRODUCT_NAME,
            serviceUrl: wayforpayServiceUrlFrom(headers),
            returnUrl: tournamentRedirectUrlFrom(
              headers,
              this.config.getEnvConfig().CORS_ORIGINS,
              tournamentId,
            ),
            lifetimeSec: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
          });
          payment.invoiceId = orderReference;
          payment.paymentPageUrl = page.url;
          payment.amountDue = amountDue;
          payment = await repo.save(payment);
          await recordPaymentConsent(manager, {
            playerId,
            product: PaymentConsentProduct.ENTRY_FEE,
            reference: payment.reference,
            amountKopecks: amountDue,
            provider: 'wayforpay',
          });
        } else {
          payment = await repo.save(payment);
        }
        return this.toIntentDto(payment, entryFee);
      }

      // The price changed since the open invoice was minted (the captain became
      // VIP, or VIP lapsed): invalidate it and mint one at the right amount. If
      // Monobank refuses, keep the old invoice rather than risk two payable ones.
      if (
        payment.invoiceId &&
        payment.amountDue != null &&
        payment.amountDue !== amountDue
      ) {
        try {
          await this.acquiring.removeInvoice(payment.invoiceId);
          payment.invoiceId = null;
          payment.paymentPageUrl = null;
        } catch (err) {
          this.logger.warn(
            `Payment ${payment.reference}: could not invalidate invoice ${payment.invoiceId} ` +
              `to re-price it (${err instanceof Error ? err.message : String(err)}); keeping it`,
          );
        }
      }

      // Reuse a live invoice so repeat clicks — or a second concurrent
      // request that just unblocked on the lock above — do not mint another.
      if (!payment.invoiceId || !payment.paymentPageUrl) {
        // Both URLs come from the request, never from env, and both throw
        // loudly when a host cannot be derived — see acquiring-urls.util.
        const webHookUrl = acquiringWebHookUrlFrom(headers);
        const redirectUrl = tournamentRedirectUrlFrom(
          headers,
          this.config.getEnvConfig().CORS_ORIGINS,
          tournamentId,
        );
        const invoice = await this.acquiring.createInvoice({
          amount: amountDue,
          reference: payment.reference,
          destination: ENTRY_FEE_PRODUCT_NAME,
          redirectUrl,
          webHookUrl,
          validitySec: invoiceValiditySeconds(
            new Date(),
            tournament.registrationEndsAt,
          ),
        });
        payment.invoiceId = invoice.invoiceId;
        payment.paymentPageUrl = invoice.pageUrl;
        payment.amountDue = amountDue;
        payment = await repo.save(payment);
        await recordPaymentConsent(manager, {
          playerId,
          product: PaymentConsentProduct.ENTRY_FEE,
          reference: payment.reference,
          amountKopecks: amountDue,
          provider: 'monobank',
        });
      }

      return this.toIntentDto(payment, entryFee);
    });
    // Registered after the lock is released, exactly like a callback would.
    if (settled.payment) await this.joinPaidTeam(settled.payment);
    return intent;
  }

  /**
   * Decides, under the payment-row lock, whether the open invoice can be handed
   * out again once WayForPay takes payments. Mutates `payment` in memory (the
   * caller saves it); returns true when the open page turned out to be paid.
   *
   * - A WayForPay page that is still live at the right price is reused.
   * - A lapsed or re-priced page is asked about first (CHECK_STATUS): paid →
   *   settled now; mid-payment → kept; otherwise dropped for a fresh page. A
   *   WayForPay page cannot be withdrawn, so a re-priced one stays payable until
   *   it lapses — paying either one settles the fee (a reference match).
   * - A Monobank invoice from before the switch is withdrawn at Monobank; if
   *   Monobank refuses it is kept, rather than risk two payable invoices.
   */
  private async reconcileForWayForPay(
    wfp: WayForPayService,
    payment: TournamentTeamPayment,
    amountDue: number,
  ): Promise<boolean> {
    if (!payment.invoiceId) return false;
    const repriced =
      payment.amountDue != null && payment.amountDue !== amountDue;
    const order = parseWfpOrderReference(payment.invoiceId);
    if (!order || order.reference !== payment.reference) {
      try {
        await this.acquiring.removeInvoice(payment.invoiceId);
        payment.invoiceId = null;
        payment.paymentPageUrl = null;
      } catch (err) {
        this.logger.warn(
          `Payment ${payment.reference}: could not withdraw Monobank invoice ${payment.invoiceId} ` +
            `after the switch to WayForPay (${err instanceof Error ? err.message : String(err)}); keeping it`,
        );
      }
      return false;
    }
    // A minute of margin: never hand out a page that lapses while it loads.
    const live = order.expiresAt.getTime() > Date.now() + 60_000;
    if (live && !repriced) return false;

    let tx: TWfpTransaction;
    try {
      tx = await wfp.checkStatus(payment.invoiceId);
    } catch (err) {
      this.logger.warn(
        `Payment ${payment.reference}: WayForPay CHECK_STATUS of ${payment.invoiceId} failed ` +
          `(${err instanceof Error ? err.message : String(err)}); keeping the page`,
      );
      return false;
    }
    const callback = wfpToInvoiceCallback(tx, payment.reference);
    if (callback.status === 'success') {
      const change = nextPaymentState(payment, callback, new Date());
      if (!change) return false;
      Object.assign(payment, change);
      this.logger.log(
        `Payment ${payment.reference}: WayForPay order ${tx.orderReference} found paid on re-request`,
      );
      return true;
    }
    // Money mid-flight on this page: never mint a second one under it.
    if (
      callback.status === 'processing' &&
      tx.transactionStatus !== 'Declined'
    ) {
      return false;
    }
    payment.invoiceId = null;
    payment.paymentPageUrl = null;
    return false;
  }

  /** The caller's own team payment for a tournament (used for polling), or null. */
  async getMyPayment(
    tournamentId: string,
    playerId: string,
  ): Promise<TournamentPaymentIntentDto | null> {
    const team = await this.findCaptainTeam(playerId);
    if (!team) return null;

    const payment = await this.paymentRepo.findByTournamentAndTeam(
      tournamentId,
      team.id,
    );
    if (!payment) return null;

    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
    const entryFee = tournament?.entryFee ?? 0;
    return this.toIntentDto(payment, entryFee);
  }

  private toIntentDto(
    payment: TournamentTeamPayment,
    entryFee: number,
  ): TournamentPaymentIntentDto {
    const amount = payment.amountDue ?? entryFee;
    return {
      reference: payment.reference,
      status: payment.status,
      amount,
      fullAmount: entryFee,
      vipDiscountPercent:
        amount < entryFee ? VIP_TOURNAMENT_DISCOUNT_PERCENT : 0,
      amountPaid: payment.amountPaid,
      pageUrl: payment.paymentPageUrl,
    };
  }

  /**
   * Applies one acquiring callback to an entry-fee payment. Returns false when
   * no payment matches so the dispatcher can try donations, then log. Idempotent
   * and order-independent: Monobank retries up to three times and does not
   * guarantee ordering, and the decision itself lives in `nextPaymentState`.
   */
  async applyInvoiceCallback(
    payload: TInvoiceCallbackPayload,
  ): Promise<boolean> {
    // invoiceId is the precise key; reference covers a push that predates the
    // row storing its invoice (e.g. a retry arriving after a failure cleared it).
    const payment =
      (await this.paymentRepo.findByInvoiceId(payload.invoiceId)) ??
      (payload.reference
        ? ((await this.paymentRepo.findByReferences([payload.reference]))[0] ??
          null)
        : null);
    if (!payment) return false;

    const change = nextPaymentState(payment, payload, new Date());
    if (!change) return true;

    payment.status = change.status;
    payment.amountPaid = change.amountPaid;
    payment.paidAt = change.paidAt;
    payment.invoiceId = change.invoiceId;
    payment.paymentPageUrl = change.paymentPageUrl;
    await this.paymentRepo.save(payment);

    this.logger.log(
      `Payment ${payment.reference}: invoice ${payload.invoiceId} -> ${payload.status} (${change.status})`,
    );

    // `nextPaymentState` treats PAID as terminal, so a PAID change is always
    // the first time this payment settles — the join runs exactly once.
    if (change.status === PaymentStatus.PAID) {
      await this.joinPaidTeam(payment);
    }
    return true;
  }

  /**
   * Registers the team right after its entry fee settles, so the captain is
   * not shown a "Join" button for a tournament they have already paid for.
   *
   * The payment is saved before this runs and stays PAID whatever happens
   * here: a failure (Dota API down, a roster that changed since the invoice
   * was minted) is logged and the captain keeps the manual join as fallback,
   * which passes the PAID gate. Never throws — the acquiring callback must
   * still answer 200 so Monobank stops retrying a payment we did record.
   */
  private async joinPaidTeam(payment: TournamentTeamPayment): Promise<void> {
    try {
      await this.qualification.joinTournamentAsPaidTeam(
        payment.tournamentId,
        payment.teamId,
      );
      this.logger.log(
        `Payment ${payment.reference}: team ${payment.teamId} registered for tournament ${payment.tournamentId}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Payment ${payment.reference}: team ${payment.teamId} paid but could not be registered for tournament ${payment.tournamentId} — ${message}. The captain can still join manually.`,
      );
    }
  }

  /** The caller's non-disbanded team where they are the captain, or null. */
  private findCaptainTeam(
    playerId: string,
    relations: string[] = ['captain'],
  ): Promise<Team | null> {
    return this.dataSource.getRepository(Team).findOne({
      where: { captain: { id: playerId }, disbandedAt: IsNull() },
      relations,
    });
  }
}
