import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Player } from '../players/player.entity';
import { Tournament } from '../tournaments/tournaments.entity';
import { TeamsController } from './teams.controller';
import { TeamsRepository } from './teams.repository';
import { TeamsService } from './teams.service';
import { Team } from './team.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Team, Player, Tournament]), AuthModule],
  providers: [TeamsService, TeamsRepository],
  controllers: [TeamsController],
})
export class TeamsModule {}
