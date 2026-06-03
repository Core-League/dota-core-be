import type { Env } from '../../entities/env';

export interface IConfigConnectorService {
  getEnvConfig(): Env;
}
