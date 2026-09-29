import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlayersService } from './players.service';
import { PlayersController } from './players.controller';
import { Player } from './player.entity';
import { PlayersRepository } from './players.repository';
import { PlayerMatchStatsRepository } from './player-match-stats.repository';
import { PlayerAchievementsRepository } from './player-achievements.repository';
import { PlayerAchievementsService } from './player-achievements.service';
import { UploadsModule } from '../uploads/uploads.module';
import { TeamsModule } from '../teams/teams.module';
import { LocationsModule } from '../locations/locations.module';
import { DiscordBotModule } from '../discord/discord-bot.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Player]),
    AuthModule,
    UploadsModule,
    TeamsModule,
    LocationsModule,
    DiscordBotModule,
  ],
  providers: [
    PlayersService,
    PlayersRepository,
    PlayerMatchStatsRepository,
    PlayerAchievementsRepository,
    PlayerAchievementsService,
  ],
  controllers: [PlayersController],
  // The analytics board reuses the trophy computation instead of re-deriving it.
  exports: [PlayerAchievementsService],
})
export class PlayersModule {}
