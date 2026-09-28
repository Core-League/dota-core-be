import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dota2Module } from '../dota2/dota2.module';
import { DueloModule } from '../duelo/duelo.module';
import { MatchParticipantsModule } from '../match-participants/match-participants.module';
import { Team } from '../teams/team.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { PlayerTournamentPoints } from '../tournaments/player-tournament-points.entity';
import { QualificationMatchRepository } from './qualification-match.repository';
import { QualificationMatch } from './qualification-match.entity';
import { Qualification } from './qualification.entity';
import { QualificationRepository } from './qualification.repository';
import { QualificationService } from './qualification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Qualification,
      QualificationMatch,
      Team,
      Tournament,
      PlayerTournamentPoints,
    ]),
    Dota2Module,
    DueloModule,
    MatchParticipantsModule,
  ],
  providers: [
    QualificationService,
    QualificationRepository,
    QualificationMatchRepository,
  ],
  exports: [QualificationService],
})
export class QualificationModule {}
