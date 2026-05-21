import './config/load-env';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayersModule } from './players/players.module';
import { UserRolesModule } from './user-roles/user-roles.module';
import { TeamsModule } from './teams/teams.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { MatchesModule } from './matches/matches.module';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { DevModule } from './dev/dev.module';

/**
 * Live deploy uses `NODE_ENV=staging` (see `ecosystem.config.js`). For TypeORM,
 * staging is treated like production: no `synchronize`, migrations on boot.
 * `production` is included for a future split or CI.
 */
const typeOrmProdLike =
  process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: !typeOrmProdLike,
      migrations: ['dist/migrations/*.js'],
      migrationsRun: typeOrmProdLike,
    }),
    PlayersModule,
    UserRolesModule,
    TeamsModule,
    TournamentsModule,
    MatchesModule,
    AuthModule,
    AdminModule,
    DevModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
