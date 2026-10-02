import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { DiscordBotModule } from '../discord/discord-bot.module';
import { Dota2Module } from '../dota2/dota2.module';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { InvitesController } from './invites.controller';
import { Team } from './team.entity';
import { TeamInvite } from './team-invite.entity';
import { Player } from '../players/player.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { TeamsRepository } from './teams.repository';
import { TeamInviteRepository } from './team-invite.repository';
import { ChatEventsModule } from '../chat/chat-access.events';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Team,
      TeamInvite,
      Player,
      Tournament,
      PlayerTournamentPoints,
    ]),
    AuthModule,
    UploadsModule,
    DiscordBotModule,
    Dota2Module,
    ChatEventsModule,
  ],
  providers: [TeamsService, TeamsRepository, TeamInviteRepository],
  controllers: [TeamsController, InvitesController],
  exports: [TeamsService],
})
export class TeamsModule {}
