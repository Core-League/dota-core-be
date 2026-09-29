import '../config/load-env';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DotaBotModule } from './dota-bot.module';

/**
 * Root module of the bot-worker process: the same Postgres as api-v1 (v1 owns
 * the schema — no synchronize, no migrations here) plus the bot pool.
 */
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      // Every entity, not only the ones DuelsCoreModule registers: Player
      // reaches UserRoles → Tournament → … and TypeORM needs the whole graph.
      entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
      autoLoadEntities: true,
      synchronize: false,
      migrationsRun: false,
    }),
    DotaBotModule,
  ],
})
export class BotWorkerModule {}
