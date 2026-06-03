import type { ForecastConfig } from '../../entities/finance/forecast';

export interface IForecastConfigRepository {
  getActive(): Promise<ForecastConfig | null>;
  setActive(config: ForecastConfig): Promise<ForecastConfig>;
}
