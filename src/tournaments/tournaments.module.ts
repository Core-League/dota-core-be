import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MonobankAcquiringModule } from '../connectors/monobank-acquiring/monobank-acquiring.module';
import { Dota2Module } from '../dota2/dota2.module';
import { QualificationModule } from '../qualification/qualification.module';
import { PlayoffModule } from '../playoff/playoff.module';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { TournamentPaymentCallbackController } from './tournament-payment-callback.controller';
import { Tournament } from './tournaments.entity';
import { TournamentPlayoffTeam } from './tournament-playoff-team.entity';
import { TournamentTeamPayment } from './tournament-team-payment.entity';
import { TournamentDonation } from './tournament-donation.entity';
import { Team } from '../teams/team.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { TournamentsRepository } from './tournaments.repository';
import { TournamentPlayoffTeamRepository } from './tournament-playoff-team.repository';
import { TournamentTeamPaymentRepository } from './tournament-team-payment.repository';
import { TournamentPaymentsService } from './tournament-payments.service';
import { TournamentDonationRepository } from './tournament-donation.repository';
import { TournamentDonationsService } from './tournament-donations.service';
import { TournamentPlayoffScheduler } from './tournament-playoff.scheduler';
import { TournamentQualificationScheduler } from './tournament-qualification.scheduler';
import { UploadsModule } from '../uploads/uploads.module';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tournament,
      TournamentPlayoffTeam,
      TournamentTeamPayment,
      TournamentDonation,
      Team,
      UserRoles,
    ]),
    AuthModule,
    UploadsModule,
    Dota2Module,
    QualificationModule,
    PlayoffModule,
    TeamsModule,
    MonobankAcquiringModule.register(),
  ],
  providers: [
    TournamentsService,
    TournamentsRepository,
    TournamentPlayoffTeamRepository,
    TournamentTeamPaymentRepository,
    TournamentPaymentsService,
    TournamentDonationRepository,
    TournamentDonationsService,
    TournamentPlayoffScheduler,
    TournamentQualificationScheduler,
  ],
  controllers: [TournamentsController, TournamentPaymentCallbackController],
})
export class TournamentsModule {}
