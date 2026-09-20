import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { TournamentTeamPayment } from './tournament-team-payment.entity';
import { PaymentStatus } from './tournament-team-payment.model';
import { generatePaymentReference } from './tournament-team-payment.util';

const MAX_REFERENCE_ATTEMPTS = 5;

@Injectable()
export class TournamentTeamPaymentRepository {
  private readonly repo: Repository<TournamentTeamPayment>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(TournamentTeamPayment);
  }

  findByTournamentAndTeam(
    tournamentId: string,
    teamId: string,
  ): Promise<TournamentTeamPayment | null> {
    return this.repo.findOne({ where: { tournamentId, teamId } });
  }

  findByTournamentId(tournamentId: string): Promise<TournamentTeamPayment[]> {
    return this.repo.find({ where: { tournamentId } });
  }

  findByInvoiceId(invoiceId: string): Promise<TournamentTeamPayment | null> {
    return this.repo.findOne({ where: { invoiceId } });
  }

  async hasPaid(tournamentId: string, teamId: string): Promise<boolean> {
    const count = await this.repo.count({
      where: { tournamentId, teamId, status: PaymentStatus.PAID },
    });
    return count > 0;
  }

  /** Generates a reference not already used, retrying on the (rare) collision. */
  async generateUniqueReference(): Promise<string> {
    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
      const reference = generatePaymentReference();
      const exists = await this.repo.count({ where: { reference } });
      if (!exists) return reference;
    }
    throw new Error('Failed to generate a unique payment reference');
  }

  save(payment: TournamentTeamPayment): Promise<TournamentTeamPayment> {
    return this.repo.save(payment);
  }

  create(payload: Partial<TournamentTeamPayment>): TournamentTeamPayment {
    return this.repo.create(payload);
  }

  findByReferences(references: string[]): Promise<TournamentTeamPayment[]> {
    if (!references.length) return Promise.resolve([]);
    return this.repo.find({ where: { reference: In(references) } });
  }
}
