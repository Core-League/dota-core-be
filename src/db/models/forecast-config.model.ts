import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type {
  ForecastDivision,
  ForecastFees,
} from '../../types/entities/finance/forecast';

/**
 * Persisted forecast calculator input (`forecast_config`). At most one
 * row has `isActive = true`; the feed and balance read that active config to
 * derive their virtual forecast rows. `divisions`/`fees` are stored as JSON;
 * all money inside is kopecks.
 */
@Entity({ name: 'forecast_config' })
export class ForecastConfigModel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'jsonb' })
  divisions: [ForecastDivision, ForecastDivision, ForecastDivision];

  @Column({ type: 'jsonb' })
  fees: ForecastFees;

  @Column({ type: 'int', default: 60 })
  prizePoolPercent: number;

  @Column({ type: 'boolean', default: false })
  isActive: boolean;
}
