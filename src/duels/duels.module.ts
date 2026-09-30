import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { RealtimeStatsService } from '../dota-bot/realtime-stats.service';
import { AuthModule } from '../auth/auth.module';
import { DuelEventsListener } from './duel-events.listener';
import { DuelMatchmakerScheduler } from './duel-matchmaker.scheduler';
import { DuelMatchmakerService } from './duel-matchmaker.service';
import { DuelsAdminController } from './duels-admin.controller';
import { DuelsController } from './duels.controller';
import { DuelsCoreModule } from './duels-core.module';
import { DuelsGateway } from './duels.gateway';

/**
 * api-v1 side of the 1v1 ladder: HTTP endpoints, the matchmaker tick and the
 * real-time channel (socket.io gateway fed by Postgres `LISTEN duel_events`).
 */
@Module({
  imports: [DuelsCoreModule, AuthModule, HttpModule],
  controllers: [DuelsController, DuelsAdminController],
  providers: [
    DuelMatchmakerService,
    DuelMatchmakerScheduler,
    RealtimeStatsService,
    DuelsGateway,
    DuelEventsListener,
  ],
})
export class DuelsModule {}
