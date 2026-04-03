import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { Tournament } from './tournaments.entity';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { TournamentsRepository } from './tournaments.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Tournament, Team, UserRoles])],
  providers: [TournamentsService, TournamentsRepository],
  controllers: [TournamentsController],
})
export class TournamentsModule {}
