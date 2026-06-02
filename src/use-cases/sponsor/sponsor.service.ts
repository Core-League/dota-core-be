import { Injectable } from '@nestjs/common';
import { ConfigConnectorService } from '../../connectors/config/config-connector.service';
import { toSponsorView } from '../../db/mappers/sponsor.mapper';
import { SponsorRepository } from '../../repos/sponsor.repository';
import type {
  Sponsor,
  SponsorView,
} from '../../types/entities/finance/sponsor';
import type { StoredTransaction } from '../../types/entities/finance/transaction';

/**
 * Sponsor catalog + transaction→sponsor matching. A sponsor matches when any of
 * its `matchers` appears (case-insensitively) in the transaction's `description`
 * or `counterIban` — the Personal API does not expose card numbers, so Duelo GG
 * is matched on the ФОП account's IBAN/description.
 */
@Injectable()
export class SponsorService {
  constructor(
    private readonly sponsorRepo: SponsorRepository,
    private readonly config: ConfigConnectorService,
  ) {}

  async list(): Promise<SponsorView[]> {
    const baseUrl = this.baseUrl();
    const sponsors = await this.sponsorRepo.findAll();
    return sponsors.map((s) => toSponsorView(s, baseUrl));
  }

  async create(sponsor: Omit<Sponsor, 'id'>): Promise<SponsorView> {
    const created = await this.sponsorRepo.create(sponsor);
    return toSponsorView(created, this.baseUrl());
  }

  async update(sponsor: Sponsor): Promise<SponsorView> {
    const updated = await this.sponsorRepo.update(sponsor);
    return toSponsorView(updated, this.baseUrl());
  }

  /** First sponsor whose matchers hit this transaction, or `null`. */
  async match(tx: StoredTransaction): Promise<Sponsor | null> {
    const haystack = [tx.description, tx.counterIban ?? '']
      .join(' ')
      .toLowerCase();
    const sponsors = await this.sponsorRepo.findAll();
    return (
      sponsors.find((sponsor) =>
        sponsor.matchers.some(
          (m) => m.length > 0 && haystack.includes(m.toLowerCase()),
        ),
      ) ?? null
    );
  }

  private baseUrl(): string {
    return (this.config.getEnvConfig().API_BASE_URL ?? '').replace(/\/+$/, '');
  }
}
