import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Match3Run } from './match3-run.entity';
import { Match3Controller } from './match3.controller';
import { Match3Service } from './match3.service';

/** Match-3 mini-game on the duels page (`/match3`): runs and the leaderboard. */
@Module({
  imports: [TypeOrmModule.forFeature([Match3Run]), AuthModule],
  controllers: [Match3Controller],
  providers: [Match3Service],
})
export class Match3Module {}
