import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DiscordBotModule } from '../discord/discord-bot.module';
import { DueloModule } from '../duelo/duelo.module';
import { Dota2Module } from '../dota2/dota2.module';
import { MatchParticipantsModule } from '../match-participants/match-participants.module';
import { Player } from '../players/player.entity';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ChatEventsModule } from '../chat/chat-access.events';

@Module({
  imports: [
    TypeOrmModule.forFeature([Player, Team, UserRoles]),
    AuthModule,
    DiscordBotModule,
    DueloModule,
    Dota2Module,
    MatchParticipantsModule,
    ChatEventsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
