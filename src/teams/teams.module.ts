import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { Team } from './team.entity';
import { Player } from '../players/player.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { TeamsRepository } from './teams.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Team, Player, Tournament, PlayerTournamentPoints]),
    AuthModule,
    UploadsModule,
  ],
  providers: [TeamsService, TeamsRepository],
  controllers: [TeamsController],
})
export class TeamsModule {}
