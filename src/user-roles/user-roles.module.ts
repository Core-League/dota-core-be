import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserRolesService } from './user-roles.service';
import { UserRolesController } from './user-roles.controller';
import { UserRoles } from './user-roles.entity';
import { Player } from '../players/player.entity';
import { UserRolesRepository } from './user-roles.repository';
import { OwnUserRoleAssignmentGuard } from './guards/own-user-role-assignment.guard';

@Module({
  imports: [TypeOrmModule.forFeature([UserRoles, Player]), AuthModule],
  providers: [
    UserRolesService,
    UserRolesRepository,
    OwnUserRoleAssignmentGuard,
  ],
  controllers: [UserRolesController],
})
export class UserRolesModule {}
