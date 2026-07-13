import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { Team } from '../teams/team.entity';
import { Tournament } from './tournaments.entity';
import { TournamentTeamPayment } from './tournament-team-payment.entity';
import { TournamentTeamPaymentRepository } from './tournament-team-payment.repository';
import { PaymentStatus } from './tournament-team-payment.model';
import { TournamentPaymentSummaryDto } from './dto/tournament-payment-summary.dto';
import { TournamentPaymentIntentDto } from './dto/tournament-payment-intent.dto';

@Injectable()
export class TournamentPaymentsService {
  constructor(
    private readonly paymentRepo: TournamentTeamPaymentRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
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
   * team on a fee'd tournament, so the captain can be redirected to the jar.
   */
  async createIntentForCaptain(
    tournamentId: string,
    playerId: string,
  ): Promise<TournamentPaymentIntentDto> {
    const tournament = await this.dataSource
      .getRepository(Tournament)
      .findOne({ where: { id: tournamentId } });
    if (!tournament) throw new NotFoundException('Турнір не знайдено');

    const entryFee = tournament.entryFee ?? 0;
    if (entryFee <= 0) {
      throw new BadRequestException('Турнір безкоштовний — оплата не потрібна');
    }

    const team = await this.findCaptainTeam(playerId);
    if (!team) {
      throw new ForbiddenException(
        'Тільки капітан команди може ініціювати оплату',
      );
    }

    let payment = await this.paymentRepo.findByTournamentAndTeam(
      tournamentId,
      team.id,
    );
    if (!payment) {
      const reference = await this.paymentRepo.generateUniqueReference();
      payment = this.paymentRepo.create({
        tournamentId,
        teamId: team.id,
        reference,
        status: PaymentStatus.PENDING,
        amountPaid: 0,
      });
      payment = await this.paymentRepo.save(payment);
    }

    return this.toIntentDto(payment, entryFee);
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
      jarUrl: this.buildJarUrl(payment.reference, entryFee),
    };
  }

  /** Composes the prefilled jar URL, or null when the jar is not configured. */
  private buildJarUrl(reference: string, amountKopecks: number): string | null {
    const base = (process.env.MONOBANK_JAR_URL ?? '').trim();
    if (!base) return null;
    try {
      const url = new URL(base);
      url.searchParams.set('a', String(Math.round(amountKopecks / 100)));
      url.searchParams.set('t', reference);
      return url.toString();
    } catch {
      return null;
    }
  }

  /** The caller's non-disbanded team where they are the captain, or null. */
  private findCaptainTeam(playerId: string): Promise<Team | null> {
    return this.dataSource.getRepository(Team).findOne({
      where: { captain: { id: playerId }, disbandedAt: IsNull() },
      relations: ['captain'],
    });
  }
}
