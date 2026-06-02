import { type DynamicModule, Module } from '@nestjs/common';
import { HttpClientConnectorModule } from '../http-client/http-client-connector.module';
import { MonobankService } from './monobank.service';

const DEFAULT_BASE_URL = 'https://api.monobank.ua';

/**
 * Provides {@link MonobankService}. Wires the shared HTTP client with the
 * Monobank base URL (from `MONOBANK_API_URL`, defaulting to the public host).
 * The `X-Token` header is applied per-request in the service, so the shared
 * http-client connector stays untouched. Register in a consuming module:
 *
 * ```ts
 * imports: [MonobankModule.register()],
 * ```
 */
@Module({})
export class MonobankModule {
  static register(): DynamicModule {
    return {
      module: MonobankModule,
      imports: [
        HttpClientConnectorModule.register(
          (config) =>
            config.getEnvConfig().MONOBANK_API_URL ?? DEFAULT_BASE_URL,
        ),
      ],
      providers: [MonobankService],
      exports: [MonobankService],
    };
  }
}
