// src/playoff/playoff.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChallongeModule } from '../challonge/challonge.module';
import { Dota2Module } from '../dota2/dota2.module';
import { DueloModule } from '../duelo/duelo.module';
import { TeamsModule } from '../teams/teams.module';
import { PlayoffMatch } from './playoff-match.entity';
import { PlayoffMatchRepository } from './playoff-match.repository';
import { PlayoffLeagueFixture } from './playoff-league-fixture.entity';
import { PlayoffSeries } from './playoff-series.entity';
import { Playoff } from './playoff.entity';
import { PlayoffRepository } from './playoff.repository';
import { PlayoffService } from './playoff.service';
import { PlayoffTeardownService } from './playoff-teardown.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Playoff,
      PlayoffMatch,
      PlayoffLeagueFixture,
      PlayoffSeries,
    ]),
    ChallongeModule,
    Dota2Module,
    DueloModule,
    TeamsModule,
  ],
  providers: [
    PlayoffService,
    PlayoffRepository,
    PlayoffMatchRepository,
    PlayoffTeardownService,
  ],
  // PlayoffRepository is exported for the tournament update path's bracket-format lock.
  exports: [PlayoffService, PlayoffRepository],
})
export class PlayoffModule {}
