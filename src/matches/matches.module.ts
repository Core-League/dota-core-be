import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Team } from '../teams/team.entity';
import { MatchesController } from './matches.controller';
import { MatchesRepository } from './matches.repository';
import { MatchesService } from './matches.service';
import { Match } from './matches.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Match, Team]), AuthModule],
  providers: [MatchesService, MatchesRepository],
  controllers: [MatchesController],
})
export class MatchesModule {}
