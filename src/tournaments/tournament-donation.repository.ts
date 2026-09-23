import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TournamentDonation } from './tournament-donation.entity';
import { generatePaymentReference } from './tournament-team-payment.util';

const MAX_REFERENCE_ATTEMPTS = 5;

/** Reference prefix that tells a donation apart from a `CORE-` entry fee. */
export const DONATION_REFERENCE_PREFIX = 'DON-';

@Injectable()
export class TournamentDonationRepository {
  private readonly repo: Repository<TournamentDonation>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(TournamentDonation);
  }

  findByInvoiceId(invoiceId: string): Promise<TournamentDonation | null> {
    return this.repo.findOne({ where: { invoiceId } });
  }

  findByReference(reference: string): Promise<TournamentDonation | null> {
    return this.repo.findOne({ where: { reference } });
  }

  /** Generates a `DON-` reference not already used, retrying on the (rare) collision. */
  async generateUniqueReference(): Promise<string> {
    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
      const reference = generatePaymentReference(DONATION_REFERENCE_PREFIX);
      const exists = await this.repo.count({ where: { reference } });
      if (!exists) return reference;
    }
    throw new Error('Failed to generate a unique donation reference');
  }

  create(payload: Partial<TournamentDonation>): TournamentDonation {
    return this.repo.create(payload);
  }

  save(donation: TournamentDonation): Promise<TournamentDonation> {
    return this.repo.save(donation);
  }
}
