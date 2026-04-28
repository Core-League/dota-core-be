import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    HttpModule.register({ timeout: 15000, maxRedirects: 3 }),
    TypeOrmModule.forFeature([Player, UserRoles]),
    AuthModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
