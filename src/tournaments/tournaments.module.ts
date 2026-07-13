import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Dota2Module } from '../dota2/dota2.module';
import { QualificationModule } from '../qualification/qualification.module';
import { PlayoffModule } from '../playoff/playoff.module';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { Tournament } from './tournaments.entity';
import { TournamentPlayoffTeam } from './tournament-playoff-team.entity';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { TournamentsRepository } from './tournaments.repository';
import { TournamentPlayoffTeamRepository } from './tournament-playoff-team.repository';
import { TournamentPlayoffScheduler } from './tournament-playoff.scheduler';
import { UploadsModule } from '../uploads/uploads.module';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tournament,
      TournamentPlayoffTeam,
      Team,
      UserRoles,
    ]),
    AuthModule,
    UploadsModule,
    Dota2Module,
    QualificationModule,
    PlayoffModule,
    TeamsModule,
  ],
  providers: [
    TournamentsService,
    TournamentsRepository,
    TournamentPlayoffTeamRepository,
    TournamentPlayoffScheduler,
  ],
  controllers: [TournamentsController],
})
export class TournamentsModule {}
