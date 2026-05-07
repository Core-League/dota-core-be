import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { DiscordBotModule } from '../discord/discord-bot.module';
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
  ],
  providers: [TeamsService, TeamsRepository, TeamInviteRepository],
  controllers: [TeamsController, InvitesController],
})
export class TeamsModule {}
