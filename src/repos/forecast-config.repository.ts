import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toForecastConfig } from '../db/mappers/forecast-config.mapper';
import { ForecastConfigModel } from '../db/models/forecast-config.model';
import type { ForecastConfig } from '../types/entities/finance/forecast';
import type { IForecastConfigRepository } from '../types/interfaced/repos/forecast-config.repository.interface';

/**
 * Single-active-row store for the forecast config. `setActive` clears the
 * previous active flag and persists the new config as the only active one.
 */
@Injectable()
export class ForecastConfigRepository implements IForecastConfigRepository {
  constructor(
    @InjectRepository(ForecastConfigModel)
    private readonly repo: Repository<ForecastConfigModel>,
  ) {}

  async getActive(): Promise<ForecastConfig | null> {
    const model = await this.repo.findOne({ where: { isActive: true } });
    return model ? toForecastConfig(model) : null;
  }

  async setActive(config: ForecastConfig): Promise<ForecastConfig> {
    await this.repo.update({ isActive: true }, { isActive: false });
    await this.repo.save(
      this.repo.create({
        divisions: config.divisions,
        fees: config.fees,
        prizePoolPercent: config.prizePoolPercent,
        isActive: true,
      }),
    );
    return config;
  }
}
