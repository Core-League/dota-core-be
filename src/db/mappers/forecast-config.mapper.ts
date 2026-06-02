import type { ForecastConfig } from '../../types/entities/finance/forecast';
import { ForecastConfigModel } from '../models/forecast-config.model';

/** TypeORM `ForecastConfigModel` → domain `ForecastConfig`. */
export function toForecastConfig(model: ForecastConfigModel): ForecastConfig {
  return {
    divisions: model.divisions,
    fees: model.fees,
    prizePoolPercent: model.prizePoolPercent,
  };
}
