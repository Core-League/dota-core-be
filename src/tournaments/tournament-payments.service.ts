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
import { ConfigConnectorService } from '../connectors/config/config-connector.service';
import { MonobankAcquiringService } from '../connectors/monobank-acquiring/monobank-acquiring.service';
import type { TInvoiceCallbackPayload } from '../connectors/monobank-acquiring/monobank-acquiring.types';
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
    if (!payment.amountPaid) payment.amountPaid = tournament.entryFee ?? 0;

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
   * Monobank-hosted payment page.
   */
  async createIntentForCaptain(
    tournamentId: string,
    playerId: string,
    headers: TRequestHeaders,
  ): Promise<TournamentPaymentIntentDto> {
    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
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

    const team = await this.findCaptainTeam(playerId);
    if (!team) {
      throw new ForbiddenException(
        'Тільки капітан команди може ініціювати оплату',
      );
    }

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
    return this.dataSource.transaction(async (manager) => {
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
          amount: entryFee,
          reference: payment.reference,
          destination: `Вступний внесок — ${tournament.name}`,
          redirectUrl,
          webHookUrl,
          validitySec: invoiceValiditySeconds(
            new Date(),
            tournament.registrationEndsAt,
          ),
        });
        payment.invoiceId = invoice.invoiceId;
        payment.paymentPageUrl = invoice.pageUrl;
        payment = await repo.save(payment);
      }

      return this.toIntentDto(payment, entryFee);
    });
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
    return {
      reference: payment.reference,
      status: payment.status,
      amount: entryFee,
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
    return true;
  }

  /** The caller's non-disbanded team where they are the captain, or null. */
  private findCaptainTeam(playerId: string): Promise<Team | null> {
    return this.dataSource.getRepository(Team).findOne({
      where: { captain: { id: playerId }, disbandedAt: IsNull() },
      relations: ['captain'],
    });
  }
}
