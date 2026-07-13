import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Team } from '../teams/team.entity';
import { Tournament } from './tournaments.entity';
import { TournamentTeamPaymentRepository } from './tournament-team-payment.repository';
import { PaymentStatus } from './tournament-team-payment.model';
import { TournamentPaymentSummaryDto } from './dto/tournament-payment-summary.dto';

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
}
