import { HttpService } from '@nestjs/axios';
import { type DynamicModule, Module } from '@nestjs/common';
import axios from 'axios';
import { ConfigConnectorService } from '../config/config-connector.service';
import { HttpClientConnectorService } from './http-client-connector.service';

const DEFAULT_OPTIONS = { timeout: 15000, maxRedirects: 3 };

/**
 * Provides {@link HttpClientConnectorService}. `getBaseUrl` receives the
 * {@link ConfigConnectorService} and returns the client's `baseURL`, so the
 * call site stays type-safe (no stringly-typed env keys). Register once per
 * consuming module:
 *
 * ```ts
 * imports: [
 *   HttpClientConnectorModule.register((config) => config.getEnvConfig().API_BASE_URL),
 * ],
 * ```
 * then `constructor(private readonly http: HttpClientConnectorService) {}`.
 */
@Module({})
export class HttpClientConnectorModule {
  static register(
    getBaseUrl: (config: ConfigConnectorService) => string | undefined,
  ): DynamicModule {
    return {
      module: HttpClientConnectorModule,
      providers: [
        {
          provide: HttpClientConnectorService,
          inject: [ConfigConnectorService],
          useFactory: (config: ConfigConnectorService) =>
            new HttpClientConnectorService(
              new HttpService(
                axios.create({
                  ...DEFAULT_OPTIONS,
                  baseURL: getBaseUrl(config),
                }),
              ),
            ),
        },
      ],
      exports: [HttpClientConnectorService],
    };
  }
}
