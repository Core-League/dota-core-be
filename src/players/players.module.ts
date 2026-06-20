import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlayersService } from './players.service';
import { PlayersController } from './players.controller';
import { Player } from './player.entity';
import { PlayersRepository } from './players.repository';
import { UploadsModule } from '../uploads/uploads.module';
import { TeamsModule } from '../teams/teams.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Player]),
    AuthModule,
    UploadsModule,
    TeamsModule,
  ],
  providers: [PlayersService, PlayersRepository],
  controllers: [PlayersController],
})
export class PlayersModule {}
