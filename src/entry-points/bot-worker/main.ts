import '../../config/load-env';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BotWorkerModule } from '../../dota-bot/bot-worker.module';

/**
 * Third process of the backend: no HTTP, just the Dota 2 host-bot pool
 * (src/dota-bot) talking to the shared database. Started by the compose
 * service `bot-worker`; `npm run start:dev:bot` locally.
 */
async function bootstrapBotWorker(): Promise<void> {
  const logger = new Logger('BotWorker');
  const app = await NestFactory.createApplicationContext(BotWorkerModule, {
    logger: ['log', 'warn', 'error'],
  });
  // SIGTERM/SIGINT → OnModuleDestroy → HostBotPool leaves lobbies and logs off.
  app.enableShutdownHooks();
  logger.log('Bot worker is running');
}

const isDirectNodeEntry =
  typeof require !== 'undefined' && require.main === module;

if (isDirectNodeEntry) {
  void bootstrapBotWorker();
}
