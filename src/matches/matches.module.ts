import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchesService } from './matches.service';
import { MatchesController } from './matches.controller';
import { Match } from './matches.entity';
import { Team } from '../teams/team.entity';
import { MatchesRepository } from './matches.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Match, Team])],
  providers: [MatchesService, MatchesRepository],
  controllers: [MatchesController],
})
export class MatchesModule {}
