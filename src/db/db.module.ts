import { Module, type DynamicModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigConnectorModule } from '../connectors/config/config-connector.module';
import { ConfigConnectorService } from '../connectors/config/config-connector.service';
import { entities } from './models';

/**
 * v2 owns its finance tables (the `*.model.ts` set in `./models`). Schema
 * behaviour mirrors v1: in `development` it synchronizes those tables on boot;
 * in `staging`/`production` it runs its own migrations (`src/db/migrations/`).
 * v1-owned tables (e.g. `team`) are not modeled here — they are read via raw
 * queries (see `TeamRepository`) so v2 never tries to own their schema.
 */
@Module({})
export class DbModule {
  static forRoot(): DynamicModule {
    return {
      module: DbModule,
      imports: [
        TypeOrmModule.forRootAsync({
          imports: [ConfigConnectorModule],
          inject: [ConfigConnectorService],
          useFactory: (config: ConfigConnectorService) => {
            const env = config.getEnvConfig();

            return {
              type: 'postgres',
              host: env.DB_HOST,
              port: Number(env.DB_PORT ?? 5432),
              username: env.DB_USER,
              password: env.DB_PASS,
              database: env.DB_NAME,
              entities,
              migrations: ['dist/db/migrations/*.js'],
              synchronize: false,
            };
          },
        }),
      ],
      exports: [TypeOrmModule],
    };
  }
}
