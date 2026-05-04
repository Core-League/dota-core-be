import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Dota2Module } from '../dota2/dota2.module';
import { QualificationModule } from '../qualification/qualification.module';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { Tournament } from './tournaments.entity';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { TournamentsRepository } from './tournaments.repository';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tournament, Team, UserRoles]),
    AuthModule,
    UploadsModule,
    Dota2Module,
    QualificationModule,
  ],
  providers: [TournamentsService, TournamentsRepository],
  controllers: [TournamentsController],
})
export class TournamentsModule {}
