// Side-effect import: loads .env (+ .env.dev overlay for dev/test) into
// process.env BEFORE the env namespace below parses it.
import './load-env';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configEnvNamespace } from './config-namespaces/env.config-namespace';
import { ConfigConnectorService } from './config-connector.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configEnvNamespace],
      cache: true,
      isGlobal: true,
      // load-env already populated process.env; don't re-read env files here.
      ignoreEnvFile: true,
    }),
  ],
  providers: [ConfigConnectorService],
  exports: [ConfigConnectorService],
})
export class ConfigConnectorModule {}
