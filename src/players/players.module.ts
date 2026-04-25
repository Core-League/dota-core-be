import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SelfOrAdminGuard } from './guards/self-or-admin.guard';
import { PlayersController } from './players.controller';
import { PlayersRepository } from './players.repository';
import { PlayersService } from './players.service';
import { Player } from './player.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Player]), AuthModule],
  providers: [PlayersService, PlayersRepository, SelfOrAdminGuard],
  controllers: [PlayersController],
})
export class PlayersModule {}
