import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayersService } from './players.service';
import { PlayersController } from './players.controller';
import { Player } from './player.entity';
import { PlayersRepository } from './players.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Player])],
  providers: [PlayersService, PlayersRepository],
  controllers: [PlayersController],
})
export class PlayersModule {}
