import type {
  Sponsor,
  SponsorWithAttachment,
} from '../../entities/finance/sponsor';

export interface ISponsorRepository {
  findAll(): Promise<SponsorWithAttachment[]>;
  findById(id: string): Promise<Sponsor | null>;
  create(sponsor: Omit<Sponsor, 'id'>): Promise<SponsorWithAttachment>;
  update(sponsor: Sponsor): Promise<SponsorWithAttachment>;
}
