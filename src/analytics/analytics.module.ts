import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { SocialChannelStat } from './social-channel-stat.entity';
import { SocialFollowersService } from './social-followers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SocialChannelStat]),
    HttpModule.register({ timeout: 10000, maxRedirects: 3 }),
    AuthModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SocialFollowersService],
})
export class AnalyticsModule {}
