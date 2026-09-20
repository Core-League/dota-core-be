import { type DynamicModule, Module } from '@nestjs/common';
import { HttpClientConnectorModule } from '../http-client/http-client-connector.module';
import { MonobankAcquiringService } from './monobank-acquiring.service';

const DEFAULT_BASE_URL = 'https://api.monobank.ua';

/**
 * Provides {@link MonobankAcquiringService}. Shares `MONOBANK_API_URL` with the
 * Personal API client — acquiring lives on the same host under
 * `/api/merchant/*` — while the `X-Token` header is applied per request.
 */
@Module({})
export class MonobankAcquiringModule {
  static register(): DynamicModule {
    return {
      module: MonobankAcquiringModule,
      imports: [
        HttpClientConnectorModule.register(
          (config) =>
            config.getEnvConfig().MONOBANK_API_URL ?? DEFAULT_BASE_URL,
        ),
      ],
      providers: [MonobankAcquiringService],
      exports: [MonobankAcquiringService],
    };
  }
}
