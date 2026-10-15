import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { RealtimeStatsService } from '../dota-bot/realtime-stats.service';
import { AuthModule } from '../auth/auth.module';
import { DiscordBotModule } from '../discord/discord-bot.module';
import { FriendsModule } from '../friends/friends.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { VipModule } from '../vip/vip.module';
import { DuelBracketsController } from './duel-brackets.controller';
import { DuelBracketsScheduler } from './duel-brackets.scheduler';
import { DuelBracketsService } from './duel-brackets.service';
import { DuelChallengesService } from './duel-challenges.service';
import { DuelEventsListener } from './duel-events.listener';
import { DuelMatchmakerScheduler } from './duel-matchmaker.scheduler';
import { DuelMatchmakerService } from './duel-matchmaker.service';
import { DuelSeasonsController } from './duel-seasons.controller';
import { DuelSeasonsScheduler } from './duel-seasons.scheduler';
import { DuelSeasonsService } from './duel-seasons.service';
import { DuelTournamentPrizesScheduler } from './duel-tournament-prizes.scheduler';
import { DuelTournamentsController } from './duel-tournaments.controller';
import { DuelTournamentsService } from './duel-tournaments.service';
import { DuelVoiceChannelsService } from './duel-voice-channels.service';
import { DuelsAdminController } from './duels-admin.controller';
import { DuelsController } from './duels.controller';
import { DuelsCoreModule } from './duels-core.module';
import { DuelsGateway } from './duels.gateway';

/**
 * api-v1 side of the 1v1 ladder: HTTP endpoints, the matchmaker tick, the
 * real-time channel (socket.io gateway fed by Postgres `LISTEN duel_events`),
 * friendly-duel challenges, the Discord voice channel per duel and the
 * single-elimination media tournaments (brackets).
 */
@Module({
  imports: [
    DuelsCoreModule,
    AuthModule,
    HttpModule,
    DiscordBotModule,
    FriendsModule,
    NotificationsModule,
    UploadsModule,
    VipModule,
  ],
  controllers: [
    DuelsController,
    DuelsAdminController,
    DuelTournamentsController,
    DuelSeasonsController,
    DuelBracketsController,
  ],
  providers: [
    DuelTournamentsService,
    DuelTournamentPrizesScheduler,
    DuelBracketsService,
    DuelBracketsScheduler,
    DuelSeasonsService,
    DuelSeasonsScheduler,
    DuelMatchmakerService,
    DuelMatchmakerScheduler,
    DuelChallengesService,
    RealtimeStatsService,
    DuelsGateway,
    DuelEventsListener,
    DuelVoiceChannelsService,
  ],
})
export class DuelsModule {}
