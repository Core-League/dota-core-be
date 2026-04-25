import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserRoles } from './user-roles.entity';
import { UserRolesController } from './user-roles.controller';
import { UserRolesRepository } from './user-roles.repository';
import { UserRolesSeeder } from './user-roles.seeder';
import { UserRolesService } from './user-roles.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserRoles]), AuthModule],
  providers: [UserRolesService, UserRolesRepository, UserRolesSeeder],
  controllers: [UserRolesController],
})
export class UserRolesModule {}
