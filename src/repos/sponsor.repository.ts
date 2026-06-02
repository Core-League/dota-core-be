import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  toSponsor,
  toSponsorModel,
  toSponsorWithAttachment,
} from '../db/mappers/sponsor.mapper';
import { SponsorModel } from '../db/models/sponsor.model';
import type {
  Sponsor,
  SponsorWithAttachment,
} from '../types/entities/finance/sponsor';
import type { ISponsorRepository } from '../types/interfaced/repos/sponsor.repository.interface';

/** Persistence + lookup for sponsors (betking / Duelo GG income sources). */
@Injectable()
export class SponsorRepository implements ISponsorRepository {
  constructor(
    @InjectRepository(SponsorModel)
    private readonly repo: Repository<SponsorModel>,
  ) {}

  async findAll(): Promise<SponsorWithAttachment[]> {
    const models = await this.repo.find({ relations: { logoAsset: true } });
    return models.map(toSponsorWithAttachment);
  }

  async findById(id: string): Promise<Sponsor | null> {
    const model = await this.repo.findOne({ where: { id } });
    return model ? toSponsor(model) : null;
  }

  async create(sponsor: Omit<Sponsor, 'id'>): Promise<SponsorWithAttachment> {
    const saved = await this.repo.save(
      this.repo.create({
        name: sponsor.name,
        logoAssetId: sponsor.logoAssetId,
        kind: sponsor.kind,
        matchers: sponsor.matchers,
      }),
    );
    return this.findOneWithAttachment(saved.id);
  }

  async update(sponsor: Sponsor): Promise<SponsorWithAttachment> {
    await this.repo.save(toSponsorModel(sponsor));
    return this.findOneWithAttachment(sponsor.id);
  }

  private async findOneWithAttachment(
    id: string,
  ): Promise<SponsorWithAttachment> {
    const model = await this.repo.findOneOrFail({
      where: { id },
      relations: { logoAsset: true },
    });
    return toSponsorWithAttachment(model);
  }
}
