import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dota2Module } from '../dota2/dota2.module';
import { MatchParticipant } from './match-participant.entity';
import { MatchParticipantsRepository } from './match-participants.repository';
import { MatchParticipantsService } from './match-participants.service';

/**
 * Per-map participant records (who really played), written on result
 * submission by the qualification / playoff services and backfilled from the
 * admin panel. Read by player statistics.
 */
@Module({
  imports: [TypeOrmModule.forFeature([MatchParticipant]), Dota2Module],
  providers: [MatchParticipantsService, MatchParticipantsRepository],
  exports: [MatchParticipantsService],
})
export class MatchParticipantsModule {}
