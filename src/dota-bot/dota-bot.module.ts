import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DuelsCoreModule } from '../duels/duels-core.module';
import { HostBotPool } from './host-bot.pool';
import { RealtimeStatsService } from './realtime-stats.service';

/**
 * The Dota 2 host-bot pool. Only the bot-worker process imports this module;
 * api-v1 never logs into Steam.
 */
@Module({
  imports: [HttpModule, DuelsCoreModule],
  providers: [RealtimeStatsService, HostBotPool],
})
export class DotaBotModule {}
