import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { TournamentsController } from './tournaments.controller';
import { TournamentsRepository } from './tournaments.repository';
import { TournamentsService } from './tournaments.service';
import { Tournament } from './tournaments.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tournament, Team, UserRoles]), AuthModule],
  providers: [TournamentsService, TournamentsRepository],
  controllers: [TournamentsController],
})
export class TournamentsModule {}
