import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { configEnvNamespace } from './config-namespaces/env.config-namespace';
import type { Env } from '../../types/entities/env';
import type { IConfigConnectorService } from '../../types/interfaced/connectors/config.connector.interface';

@Injectable()
export class ConfigConnectorService implements IConfigConnectorService {
  constructor(
    @Inject(configEnvNamespace.KEY)
    private readonly envConfig: ConfigType<typeof configEnvNamespace>,
  ) {}

  getEnvConfig(): Env {
    return this.envConfig;
  }
}
