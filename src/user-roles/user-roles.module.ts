import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRolesService } from './user-roles.service';
import { UserRolesController } from './user-roles.controller';
import { UserRoles } from './user-roles.entity';
import { Player } from '../players/player.entity';
import { UserRolesRepository } from './user-roles.repository';

@Module({
  imports: [TypeOrmModule.forFeature([UserRoles, Player])],
  providers: [UserRolesService, UserRolesRepository],
  controllers: [UserRolesController],
})
export class UserRolesModule {}
