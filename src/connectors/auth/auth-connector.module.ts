import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigConnectorModule } from '../config/config-connector.module';
import { ConfigConnectorService } from '../config/config-connector.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigConnectorModule],
      inject: [ConfigConnectorService],
      useFactory: (config: ConfigConnectorService) => {
        const env = config.getEnvConfig();
        const defaultTtlSec = 60 * 60 * 24 * 7;
        return {
          secret: env.JWT_SECRET,
          signOptions: {
            expiresIn: env.JWT_EXPIRES_SEC
              ? Number(env.JWT_EXPIRES_SEC)
              : defaultTtlSec,
          },
        };
      },
    }),
    ConfigConnectorModule,
  ],
  providers: [JwtStrategy, JwtAuthGuard, AdminGuard],
  exports: [JwtAuthGuard, AdminGuard, PassportModule],
})
export class AuthConnectorModule {}
