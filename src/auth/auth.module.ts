import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Player } from '../players/player.entity';
import { UserRoles } from '../user-roles/user-roles.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminGuard } from './guards/admin.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

/** Default access-token lifetime in seconds (7 days). Override with JWT_EXPIRES_SEC. */
const defaultJwtTtlSec = 60 * 60 * 24 * 7;

@Module({
  imports: [
    HttpModule.register({ timeout: 15000, maxRedirects: 3 }),
    TypeOrmModule.forFeature([Player, UserRoles]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: process.env.JWT_EXPIRES_SEC
          ? Number(process.env.JWT_EXPIRES_SEC)
          : defaultJwtTtlSec,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, AdminGuard],
  exports: [JwtModule, JwtAuthGuard, AdminGuard, PassportModule],
})
export class AuthModule {}
